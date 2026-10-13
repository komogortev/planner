// /ai/calls — one model call on a prompt the device composed (H5-MODELS §4, §6). Every call runs as a Workflow instance
// (D-91): a request handler dies with its client and `waitUntil` lasts ~30 s after it, while a harness-sized call takes
// 10–58 s (H5-S1-SPIKE). So POST answers at once with a call id and the device reads the outcome with GET.
//
// The prompt sits in the call row only while the call runs; the Workflow instance carries ids only, so no prompt text sits
// in Workflow state (D-87). The reply is kept until the device says it stored the run, or 7 days.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { Hono, type Context } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import { KeyBoxUnavailable, openKey } from './keyBox'
import { getModel } from './models'
import { callModel, type CallStatus } from './providers'
import { isFormat } from './modelRules'
import { overLimit, tooMany } from './ratelimit'
import type { Env } from './index'
import { RECORD_ID } from '../../src/domain/records'

export const PROMPT_MAX_BYTES = 150_000
export const DAILY_CAP_DEFAULT = 30
export const REPLY_KEEP_MS = 7 * 86_400_000
// A claimed call past the Workflow step's 15-minute timeout can no longer finish; an unclaimed one has waited for a step
// far longer than any queue should hold it. Either is reported as lost, and its prompt is cleared.
export const LOST_AFTER_MS = 16 * 60_000
export const UNCLAIMED_LOST_MS = 30 * 60_000

/** `pending`: waiting for its Workflow step. `calling`: claimed by a step, provider call in flight (one per row). */
export type CallRowStatus = 'pending' | 'calling' | CallStatus | 'no_key' | 'lost'
export interface CallRow {
  user_id: string; id: string; model_id: string; stage: string; run_id: string | null; entry_count: number; prompt_bytes: number
  prompt: string | null; status: CallRowStatus; stop: string | null; tokens_in: number | null; tokens_out: number | null
  reply: string | null; started_at: number; claimed_at: number | null; finished_at: number | null; reply_cleared_at: number | null
}
export interface CallParams { userId: string; callId: string }

/** The device's view of a call. Never the prompt; `calling` reads as `pending` (both mean "not finished yet"). */
export const callView = (r: CallRow) => ({
  id: r.id, modelId: r.model_id, stage: r.stage, runId: r.run_id, status: r.status === 'calling' ? 'pending' : r.status, stop: r.stop,
  tokensIn: r.tokens_in, tokensOut: r.tokens_out, reply: r.reply, replyCleared: r.reply_cleared_at !== null,
  startedAt: r.started_at, finishedAt: r.finished_at,
})

const getCall = (db: D1Database, userId: string, id: string) =>
  db.prepare('SELECT * FROM ai_calls WHERE user_id = ? AND id = ?').bind(userId, id).first<CallRow>()

/**
 * The limits D-87 / D-94 promise, enforced for one user whenever their calls are touched (start, read, export): replies
 * past their keep time are cleared, and calls that can no longer finish become `lost` with their prompt cleared. No cron:
 * a row not yet swept is reachable only by its own account, and that account's next touch sweeps it.
 */
export function sweepStatements(db: D1Database, userId: string, now: number): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE ai_calls SET reply = NULL, reply_cleared_at = ? WHERE user_id = ? AND reply IS NOT NULL AND finished_at < ?').bind(now, userId, now - REPLY_KEEP_MS),
    db.prepare(
      `UPDATE ai_calls SET status = 'lost', prompt = NULL, finished_at = ?1 WHERE user_id = ?2 AND (
         (status = 'pending' AND started_at < ?3) OR (status = 'calling' AND claimed_at < ?4))`,
    ).bind(now, userId, now - UNCLAIMED_LOST_MS, now - LOST_AFTER_MS),
  ]
}
export const sweep = (db: D1Database, userId: string) => db.batch(sweepStatements(db, userId, Date.now()))

type Outcome = { stop: string | null; tokensIn: number | null; tokensOut: number | null; text: string }
type Finish = (status: CallRowStatus, o?: Outcome) => Promise<CallRowStatus>

/**
 * The work of one call, run inside the Workflow step. At most one provider call per row: the step first claims the row
 * (`pending` -> `calling`, conditional), so a second execution of the same step - a replay after an eviction - finds it
 * claimed and calls nobody. The cost of that rule: a step that dies mid-call leaves a `calling` row that becomes `lost`;
 * a lost reply, never a second bill. The final write is conditional on the claim too.
 */
export async function runCall(env: Env, p: CallParams, fetchFn: typeof fetch = fetch): Promise<CallRowStatus> {
  const claimed = await env.DB.prepare(
    "UPDATE ai_calls SET status = 'calling', claimed_at = ? WHERE user_id = ? AND id = ? AND status = 'pending' AND prompt IS NOT NULL",
  ).bind(Date.now(), p.userId, p.callId).run()
  const call = await getCall(env.DB, p.userId, p.callId)
  if (!claimed.meta.changes || !call || call.prompt === null) return call?.status ?? 'lost'
  const finish: Finish = async (status, o) => {
    await env.DB.prepare(
      `UPDATE ai_calls SET status = ?3, stop = ?4, tokens_in = ?5, tokens_out = ?6, reply = ?7, finished_at = ?8, prompt = NULL
       WHERE user_id = ?1 AND id = ?2 AND status = 'calling'`,
    ).bind(p.userId, p.callId, status, o?.stop ?? null, o?.tokensIn ?? null, o?.tokensOut ?? null, status === 'ok' ? o!.text : null, Date.now()).run()
    return status
  }
  try {
    return await callAndFinish(env, p, call, call.prompt, fetchFn, finish)
  } catch (err) {
    // Whatever failed, the prompt does not outlive the attempt (D-94). Best effort: if D1 itself failed, the sweep clears it.
    await env.DB.prepare("UPDATE ai_calls SET status = 'lost', prompt = NULL, finished_at = ? WHERE user_id = ? AND id = ? AND status = 'calling'")
      .bind(Date.now(), p.userId, p.callId).run().catch(() => {})
    throw err
  }
}

async function callAndFinish(env: Env, p: CallParams, call: CallRow, prompt: string, fetchFn: typeof fetch, finish: Finish): Promise<CallRowStatus> {
  const model = await getModel(env.DB, p.userId, call.model_id)
  if (!model || model.key_ct === null || model.key_iv === null || !isFormat(model.format)) return finish('no_key')
  let key: string | null
  try {
    key = await openKey(env.MODEL_KEY_SECRET, model.key_ct, model.key_iv, p.userId, model.id, model.base_url)
  } catch (err) {
    if (err instanceof KeyBoxUnavailable) { console.error(`ai call: ${err.message}`); return finish('no_key') }
    throw err
  }
  if (key === null) return finish('no_key')
  const out = await callModel({ format: model.format, baseUrl: model.base_url, model: model.model, maxTokens: model.max_tokens }, key, prompt, fetchFn)
  return finish(out.status, out)
}

export class ModelCallWorkflow extends WorkflowEntrypoint<Env, CallParams> {
  async run(event: Readonly<WorkflowEvent<CallParams>>, step: WorkflowStep): Promise<string> {
    // No retries: a retried call can be a second paid call. Whether a failed call is billed differs per provider; retries
    // above 0 wait on that reading (H5-S1-SPIKE §5, carried into S1).
    return step.do('call', { retries: { limit: 0, delay: 1000 }, timeout: '15 minutes' }, () => runCall(this.env, event.payload))
  }
}

type Vars = { session: AuthedSession }
type C = Context<{ Bindings: Env; Variables: Vars }>
export interface CallInput { modelId: string; stage: 'harness' | 'widget' | 'test'; runId: string | null; prompt: string; entryCount: number }

/** Shared by POST /ai/calls and POST /me/models/:id/test: limits, the pending row, then the Workflow. */
export async function startCall(c: C, input: CallInput): Promise<Response> {
  const userId = c.get('session').id
  if (await overLimit(c.env, 'RL_AI_USER', userId)) return tooMany(c)
  const model = await getModel(c.env.DB, userId, input.modelId)
  if (!model) return c.json({ error: 'model: not found' }, 404)
  if (model.key_ct === null) return c.json({ error: 'model: no key' }, 409)
  const now = Date.now()
  const cap = Number(c.env.AI_DAILY_CAP) > 0 ? Number(c.env.AI_DAILY_CAP) : DAILY_CAP_DEFAULT
  const id = crypto.randomUUID()
  const bytes = new TextEncoder().encode(input.prompt).length
  const results = await c.env.DB.batch([
    ...sweepStatements(c.env.DB, userId, now),
    // The cap check and the insert are one statement, so parallel starts cannot all pass a count read before any insert.
    c.env.DB.prepare(
      `INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, prompt, status, started_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9
       WHERE (SELECT COUNT(*) FROM ai_calls WHERE user_id = ?1 AND started_at > ?10) < ?11`,
    ).bind(userId, id, model.id, input.stage, input.runId, input.entryCount, bytes, input.prompt, now, now - 86_400_000, cap),
  ])
  if (!results.at(-1)!.meta.changes) return c.json({ error: `daily cap of ${cap} model calls reached` }, 429)
  try {
    await c.env.MODEL_CALL.create({ id, params: { userId, callId: id }, retention: { successRetention: '1 day', errorRetention: '3 days' } })
  } catch (err) {
    console.error('ai call: workflow did not start', err instanceof Error ? err.name : 'error')
    await c.env.DB.prepare("UPDATE ai_calls SET status = 'lost', prompt = NULL, finished_at = ? WHERE user_id = ? AND id = ? AND status = 'pending'").bind(Date.now(), userId, id).run()
    return c.json({ error: 'could not start the call' }, 503)
  }
  return c.json({ id, status: 'pending' }, 202)
}

export const aiCallsApi = new Hono<{ Bindings: Env; Variables: Vars }>()

aiCallsApi.use('*', async (c, next) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
})

// POST /ai/calls { modelId, stage: 'harness' | 'widget', runId, prompt, entryCount }
aiCallsApi.post('/', async (c) => {
  const declared = Number(c.req.header('Content-Length') ?? 0)
  if (declared > PROMPT_MAX_BYTES + 2_000) return c.json({ error: `prompt over ${PROMPT_MAX_BYTES} bytes` }, 413)
  let body: Record<string, unknown>
  try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'not JSON' }, 400) }
  const { modelId, stage, runId, prompt, entryCount } = body ?? {}
  if (typeof modelId !== 'string' || !RECORD_ID.test(modelId)) return c.json({ error: 'modelId: not an id' }, 400)
  if (stage !== 'harness' && stage !== 'widget') return c.json({ error: 'stage: harness or widget' }, 400)
  if (typeof runId !== 'string' || !RECORD_ID.test(runId)) return c.json({ error: 'runId: not an id' }, 400)
  if (typeof prompt !== 'string' || prompt.length === 0) return c.json({ error: 'prompt: missing' }, 400)
  if (new TextEncoder().encode(prompt).length > PROMPT_MAX_BYTES) return c.json({ error: `prompt over ${PROMPT_MAX_BYTES} bytes` }, 413)
  if (!Number.isInteger(entryCount) || (entryCount as number) < 0 || (entryCount as number) > 1000) return c.json({ error: 'entryCount: 0–1000' }, 400)
  return startCall(c, { modelId, stage, runId, prompt, entryCount: entryCount as number })
})

aiCallsApi.get('/:id', async (c) => {
  const userId = c.get('session').id
  await sweep(c.env.DB, userId)
  const row = await getCall(c.env.DB, userId, c.req.param('id'))
  return row ? c.json(callView(row)) : c.json({ error: 'not found' }, 404)
})

// PATCH /ai/calls/:id { stored: true } — the device stored the run: the reply is no longer needed here.
aiCallsApi.patch('/:id', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'not JSON' }, 400) }
  if ((body as { stored?: unknown } | null)?.stored !== true) return c.json({ error: 'stored: must be true' }, 400)
  // Only a finished call: marking a pending one would let its reply land after the mark and stay.
  const r = await c.env.DB.prepare("UPDATE ai_calls SET reply = NULL, reply_cleared_at = ? WHERE user_id = ? AND id = ? AND reply_cleared_at IS NULL AND status NOT IN ('pending', 'calling')")
    .bind(Date.now(), c.get('session').id, c.req.param('id')).run()
  if (r.meta.changes) return c.json({ stored: true })
  const row = await getCall(c.env.DB, c.get('session').id, c.req.param('id'))
  if (!row) return c.json({ error: 'not found' }, 404)
  return row.status === 'pending' || row.status === 'calling' ? c.json({ error: 'the call is still running' }, 409) : c.json({ stored: true }) // already cleared: same answer
})
