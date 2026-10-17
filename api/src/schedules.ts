// H5 S3-1 — the Morning schedule (docs/H5-S3-SCHEDULES.md, D-123…D-133). The Worker composes the harness run from the
// account's own rows while the app is closed, calls the account's default model through the same Workflow an on-demand run
// uses, and leaves the reply waiting in `ai_calls`; the first device to open checks and stores it (`GET /me/schedules/waiting`).
//
// Everything here is account-scoped: every statement filters on `user_id`, and the tick takes the account from the schedule
// row it is working on, never from anything else (A12(c)).
import { Hono } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import { DAILY_CAP_DEFAULT, PROMPT_MAX_BYTES, type CallParams } from './aiCalls'
import { toEntry, COLS, type Raw } from './entries'
import type { ModelRow } from './models'
import type { Env } from './index'
import type { Entry } from '../../src/domain/entry'
import { composeHarness2, readAssessment, readQuestion, type HarnessData2 } from '../../src/domain/harness2'
import { parseHarnessOutput2 } from '../../src/domain/harness2Reply'

/** Technical failures in a row that pause a schedule (D-128). */
export const FAILS_TO_PAUSE = 3
const HARNESS_LANGUAGE = 'the same language as the notes they come from'
export const DEFAULT_HOUR = 6

export interface ScheduleRow {
  user_id: string; id: string; kind: 'morning'; hour: number; zone: string; enabled: number; paused_reason: string | null
  fail_count: number; last_day: string | null; last_call_id: string | null; created_at: number; updated_at: number
}

export const scheduleView = (r: ScheduleRow) => ({
  kind: r.kind, hour: r.hour, zone: r.zone, enabled: r.enabled === 1, pausedReason: r.paused_reason, failCount: r.fail_count,
  lastDay: r.last_day, lastCallId: r.last_call_id, updatedAt: r.updated_at,
})

/** The operator's brake (D-129): `SCHEDULES_PAUSED=true` stops every account's schedules with no code deploy. */
export const operatorPaused = (env: Pick<Env, 'SCHEDULES_PAUSED'>) => env.SCHEDULES_PAUSED === 'true' || env.SCHEDULES_PAUSED === '1'

export function validZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The calendar day and hour in `zone` at `now`. */
export function localParts(now: number, zone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

// ── the tick ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type TickResult = { considered: number; started: number; skipped: Record<string, number> }
export type Starter = (env: Env, p: CallParams) => Promise<void>

const startWorkflow: Starter = async (env, p) => {
  await env.MODEL_CALL.create({ id: p.callId, params: p, retention: { successRetention: '1 day', errorRetention: '3 days' } })
}

/** A reply still waiting unstored, or a call still running: the schedule does not call again (D-128). */
async function replyWaiting(db: D1Database, userId: string, callId: string | null): Promise<boolean> {
  if (callId === null) return false
  const row = await db.prepare('SELECT status, reply, reply_cleared_at FROM ai_calls WHERE user_id = ? AND id = ?').bind(userId, callId)
    .first<{ status: string; reply: string | null; reply_cleared_at: number | null }>()
  if (!row) return false
  if (row.status === 'pending' || row.status === 'calling') return true
  return row.status === 'ok' && row.reply !== null && row.reply_cleared_at === null
}

/**
 * Hourly (cron `5 * * * *`, D-132): start one run for each schedule that is due. Due = enabled, not paused, the zone's hour
 * has reached the schedule's, today's run not started, and no earlier reply waiting. A schedule is claimed with one
 * conditional UPDATE before anything is paid for, so two ticks for the same hour start one run (A12(d)).
 */
export async function runSchedules(env: Env, now = Date.now(), start: Starter = startWorkflow): Promise<TickResult> {
  const out: TickResult = { considered: 0, started: 0, skipped: {} }
  const skip = (why: string) => { out.skipped[why] = (out.skipped[why] ?? 0) + 1 }
  if (operatorPaused(env)) { skip('operator-paused'); return out }
  const { results } = await env.DB.prepare('SELECT * FROM schedules WHERE enabled = 1 AND paused_reason IS NULL').all<ScheduleRow>()
  const cap = Number(env.AI_DAILY_CAP) > 0 ? Number(env.AI_DAILY_CAP) : DAILY_CAP_DEFAULT
  for (const s of results) {
    out.considered++
    try {
      const local = localParts(now, s.zone)
      if (local.hour < s.hour) { skip('before-hour'); continue }
      if (s.last_day !== null && s.last_day >= local.day) { skip('already-today'); continue }
      if (await replyWaiting(env.DB, s.user_id, s.last_call_id)) { skip('reply-waiting'); continue }
      const model = await env.DB.prepare('SELECT * FROM models WHERE user_id = ? AND is_default = 1 AND key_ct IS NOT NULL').bind(s.user_id).first<ModelRow>()
      if (!model) { skip('no-default-model'); continue }
      const callId = crypto.randomUUID()
      const claim = await env.DB.prepare(
        'UPDATE schedules SET last_day = ?1, last_call_id = ?2, updated_at = ?3 WHERE user_id = ?4 AND id = ?5 AND enabled = 1 AND paused_reason IS NULL AND (last_day IS NULL OR last_day < ?1)',
      ).bind(local.day, callId, now, s.user_id, s.id).run()
      if (!claim.meta.changes) { skip('claimed-elsewhere'); continue }
      const release = () => env.DB.prepare('UPDATE schedules SET last_day = ?1, last_call_id = ?2 WHERE user_id = ?3 AND id = ?4 AND last_call_id = ?5').bind(s.last_day, s.last_call_id, s.user_id, s.id, callId).run()
      // The call row is written empty ('pending', no prompt); the Workflow's compose step fills it. The cap is the same one
      // on-demand runs count against (D-130), checked in the insert itself.
      const ins = await env.DB.prepare(
        `INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, prompt, status, started_at)
         SELECT ?1, ?2, ?3, 'harness', ?2, 0, 0, NULL, 'pending', ?4
         WHERE (SELECT COUNT(*) FROM ai_calls WHERE user_id = ?1 AND started_at > ?5) < ?6`,
      ).bind(s.user_id, callId, model.id, now, now - 86_400_000, cap).run()
      if (!ins.meta.changes) { await release(); skip('daily-cap'); continue }
      try {
        await start(env, { userId: s.user_id, callId, scheduled: true })
      } catch (err) {
        console.error('schedule: workflow did not start', err instanceof Error ? err.name : 'error')
        await env.DB.prepare("UPDATE ai_calls SET status = 'lost', finished_at = ? WHERE user_id = ? AND id = ? AND status = 'pending'").bind(Date.now(), s.user_id, callId).run()
        await release()
        skip('workflow-did-not-start')
        continue
      }
      out.started++
    } catch (err) {
      console.error('schedule: tick failed for one account', err instanceof Error ? err.name : 'error')
      skip('error')
    }
  }
  return out
}

// ── the compose step (D-133) ───────────────────────────────────────────────────────────────────────────────────────

type RawRecord = { kind: string; id: string; data: string; deleted_at: string | null }

/** The account's live rows in the shape `loadHarnessData2` hands the composer. One batch, filtered by account in every statement. */
export async function loadHarnessData(db: D1Database, userId: string): Promise<HarnessData2> {
  const [e, r] = await db.batch([
    db.prepare(`SELECT ${COLS} FROM entries WHERE user_id = ? AND deleted_at IS NULL`).bind(userId),
    db.prepare("SELECT kind, id, data, deleted_at FROM records WHERE user_id = ? AND deleted_at IS NULL AND kind IN ('assessment','question','task','taskProposal','entryState')").bind(userId),
  ])
  const rows = new Map<string, unknown[]>()
  for (const rec of r!.results as RawRecord[]) {
    const list = rows.get(rec.kind) ?? []
    list.push({ id: rec.id, ...(JSON.parse(rec.data) as object), deletedAt: rec.deleted_at })
    rows.set(rec.kind, list)
  }
  const of = <T>(kind: string) => (rows.get(kind) ?? []) as T[]
  return {
    entries: (e!.results as Raw[]).map(toEntry) as Entry[],
    assessments: of<Parameters<typeof readAssessment>[0]>('assessment').map(readAssessment),
    questions: of<Parameters<typeof readQuestion>[0]>('question').map(readQuestion),
    tasks: of<HarnessData2['tasks'][number]>('task'),
    proposals: of<HarnessData2['proposals'][number]>('taskProposal'),
    states: of<HarnessData2['states'][number]>('entryState'),
  }
}

export type ComposeOutcome = 'ready' | 'empty' | 'failed'

/**
 * Workflow step 1 of a scheduled call. Composes the same prompt a device would, stores it with the run header (ids only,
 * D-87) on the call row, and returns. Nothing to assess is `empty`: no call, no cost, no failure counted.
 */
export async function composeScheduled(env: Env, p: CallParams, now = Date.now()): Promise<ComposeOutcome> {
  const fail = async (status: string): Promise<ComposeOutcome> => {
    await env.DB.prepare("UPDATE ai_calls SET status = ?3, prompt = NULL, finished_at = ?4 WHERE user_id = ?1 AND id = ?2 AND status = 'pending'").bind(p.userId, p.callId, status, Date.now()).run()
    return status === 'empty' ? 'empty' : 'failed'
  }
  try {
    const s = await env.DB.prepare('SELECT * FROM schedules WHERE user_id = ? AND last_call_id = ?').bind(p.userId, p.callId).first<ScheduleRow>()
    if (!s) return fail('lost')
    const out = composeHarness2(await loadHarnessData(env.DB, p.userId), { runId: p.callId, now: new Date(now).toISOString(), timeZone: s.zone, language: HARNESS_LANGUAGE })
    if (!out) return fail('empty')
    const bytes = new TextEncoder().encode(out.prompt).length
    if (bytes > PROMPT_MAX_BYTES) return fail('bad_request')
    const r = await env.DB.prepare(
      "UPDATE ai_calls SET prompt = ?3, prompt_bytes = ?4, entry_count = ?5, header = ?6 WHERE user_id = ?1 AND id = ?2 AND status = 'pending'",
    ).bind(p.userId, p.callId, out.prompt, bytes, out.header.toAssessIds.length + out.header.contextIds.length, JSON.stringify(out.header)).run()
    return r.meta.changes ? 'ready' : 'failed'
  } catch (err) {
    console.error('schedule: compose failed', err instanceof Error ? err.name : 'error')
    return fail('lost')
  }
}

// ── the settle step (D-128) ────────────────────────────────────────────────────────────────────────────────────────

/** Statuses that say the provider or the reply failed. `empty` (nothing to do) and `lost` (ours, infrastructure) do not count. */
const NOT_COUNTED = new Set(['empty', 'lost'])

/**
 * Workflow's last step of a scheduled call: a reply that parses resets the count; a technical failure adds one, and the third
 * in a row pauses the schedule with the reason (D-128). Guarded by `last_call_id`, so only the schedule's current run counts.
 */
export async function settleSchedule(env: Env, p: CallParams): Promise<string> {
  const call = await env.DB.prepare('SELECT status, reply FROM ai_calls WHERE user_id = ? AND id = ?').bind(p.userId, p.callId).first<{ status: string; reply: string | null }>()
  if (!call || NOT_COUNTED.has(call.status)) return call?.status ?? 'missing'
  let status = call.status
  if (status === 'ok' && !(call.reply !== null && parseHarnessOutput2(call.reply).ok)) {
    // The reply does not parse: it can never be stored, so it is not left waiting for a device.
    status = 'bad_request'
    await env.DB.prepare("UPDATE ai_calls SET status = 'bad_request', reply = NULL, reply_cleared_at = ? WHERE user_id = ? AND id = ? AND status = 'ok'").bind(Date.now(), p.userId, p.callId).run()
  }
  if (status === 'ok') {
    await env.DB.prepare('UPDATE schedules SET fail_count = 0, updated_at = ? WHERE user_id = ? AND last_call_id = ?').bind(Date.now(), p.userId, p.callId).run()
  } else {
    await env.DB.prepare(
      `UPDATE schedules SET fail_count = fail_count + 1, updated_at = ?1,
         paused_reason = CASE WHEN fail_count + 1 >= ?2 THEN ?3 ELSE paused_reason END
       WHERE user_id = ?4 AND last_call_id = ?5`,
    ).bind(Date.now(), FAILS_TO_PAUSE, status, p.userId, p.callId).run()
  }
  return status
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Vars = { session: AuthedSession }
export const schedulesApi = new Hono<{ Bindings: Env; Variables: Vars }>()

schedulesApi.use('*', async (c, next) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
})

// GET /me/schedules → { schedules, operatorPaused }
schedulesApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY kind').bind(c.get('session').id).all<ScheduleRow>()
  return c.json({ schedules: results.map(scheduleView), operatorPaused: operatorPaused(c.env) })
})

// GET /me/schedules/waiting → finished, unstored scheduled replies, oldest first (D-135). `header` is ids and times only.
schedulesApi.get('/waiting', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, model_id, header, reply, started_at FROM ai_calls
     WHERE user_id = ? AND header IS NOT NULL AND status = 'ok' AND reply IS NOT NULL AND reply_cleared_at IS NULL ORDER BY started_at, id`,
  ).bind(c.get('session').id).all<{ id: string; model_id: string; header: string; reply: string; started_at: number }>()
  return c.json({ waiting: results.map((r) => ({ callId: r.id, modelId: r.model_id, header: JSON.parse(r.header) as unknown, reply: r.reply, startedAt: r.started_at })) })
})

// PUT /me/schedules/morning { hour?, zone?, enabled? } — create or change. Turning it on clears a pause and the failure count.
// One schedule kind, so the account's "pause schedules" (D-129) is this schedule's `enabled`.
schedulesApi.put('/morning', async (c) => {
  let body: Record<string, unknown>
  try { body = ((await c.req.json()) ?? {}) as Record<string, unknown> } catch { return c.json({ error: 'not JSON' }, 400) }
  const userId = c.get('session').id
  const cur = await c.env.DB.prepare("SELECT * FROM schedules WHERE user_id = ? AND kind = 'morning'").bind(userId).first<ScheduleRow>()
  const hour = body.hour === undefined ? cur?.hour ?? DEFAULT_HOUR : body.hour
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return c.json({ error: 'hour: 0–23' }, 400)
  const zone = body.zone === undefined ? cur?.zone : body.zone
  if (!validZone(zone)) return c.json({ error: 'zone: not a time zone' }, 400)
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return c.json({ error: 'enabled: boolean' }, 400)
  const enabled = body.enabled === undefined ? cur?.enabled ?? 1 : body.enabled ? 1 : 0
  const now = Date.now()
  if (!cur) {
    await c.env.DB.prepare(
      "INSERT INTO schedules (user_id, id, kind, hour, zone, enabled, created_at, updated_at) VALUES (?, ?, 'morning', ?, ?, ?, ?, ?) ON CONFLICT (user_id, kind) DO NOTHING",
    ).bind(userId, crypto.randomUUID(), hour, zone, enabled, now, now).run()
  }
  // Turning it on again is the owner's answer to a pause: the count starts over.
  const reset = body.enabled === true && (cur?.enabled === 0 || cur?.paused_reason != null)
  await c.env.DB.prepare(
    `UPDATE schedules SET hour = ?1, zone = ?2, enabled = ?3, updated_at = ?4,
       paused_reason = CASE WHEN ?5 THEN NULL ELSE paused_reason END, fail_count = CASE WHEN ?5 THEN 0 ELSE fail_count END
     WHERE user_id = ?6 AND kind = 'morning'`,
  ).bind(hour, zone, enabled, now, reset ? 1 : 0, userId).run()
  const row = await c.env.DB.prepare("SELECT * FROM schedules WHERE user_id = ? AND kind = 'morning'").bind(userId).first<ScheduleRow>()
  return c.json(scheduleView(row!))
})
