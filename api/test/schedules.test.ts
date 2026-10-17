// H5 S3-1 — the Morning schedule on the Worker (docs/H5-S3-SCHEDULES.md, A12). No provider and no Workflow is reached: the
// tick takes a starter stub, and the call step takes a fetch stub.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { runCall } from '../src/aiCalls'
import { createSession } from '../src/auth'
import { composeScheduled, FAILS_TO_PAUSE, localParts, runSchedules, settleSchedule, validZone } from '../src/schedules'
import type { Env } from '../src/index'
import app from '../src/index'

const API = 'https://api.test'
const ZONE = 'America/Toronto'
// 2026-10-17 11:30 UTC = 07:30 in Toronto (EDT): after a 6 o'clock schedule, before an 8 o'clock one.
const NOW = Date.UTC(2026, 9, 17, 11, 30)
const REPLY = '{"tasks":[],"questions":[]}'

async function account() {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, `${id}@example.com`, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}
const call = (token: string, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }), env)

async function addModel(a: { token: string }, isDefault = true) {
  const res = await call(a.token, '/me/models/m1', {
    method: 'PUT',
    body: JSON.stringify({ label: 'M', format: 'openai-chat', baseUrl: 'https://llm.example.com/v1', model: 'm-1', maxTokens: 4000, key: 'sk-test-0000' }),
  })
  expect(res.status).toBe(200)
  if (!isDefault) return
}
async function addNote(userId: string, body: string, n = 1) {
  const v = (await env.DB.prepare('UPDATE users SET version_seq = version_seq + 1 WHERE id = ? RETURNING version_seq').bind(userId).first<{ version_seq: number }>())!.version_seq
  await env.DB.prepare(
    `INSERT INTO entries (user_id, id, body, created_at, occurred_at, category_id, tags, origin, updated_at, deleted_at, server_version, received_at)
     VALUES (?, ?, ?, ?, NULL, NULL, '[]', 'author', ?, NULL, ?, ?)`,
  ).bind(userId, crypto.randomUUID(), body, new Date(NOW - n * 3_600_000).toISOString(), new Date(NOW - n * 3_600_000).toISOString(), v, Date.now()).run()
}
async function addSchedule(userId: string, over: Partial<{ hour: number; zone: string; enabled: number; paused: string | null; lastDay: string | null; lastCall: string | null }> = {}) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO schedules (user_id, id, kind, hour, zone, enabled, paused_reason, last_day, last_call_id, created_at, updated_at)
     VALUES (?, ?, 'morning', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(userId, id, over.hour ?? 6, over.zone ?? ZONE, over.enabled ?? 1, over.paused ?? null, over.lastDay ?? null, over.lastCall ?? null, Date.now(), Date.now()).run()
  return id
}
const schedule = (userId: string) => env.DB.prepare('SELECT * FROM schedules WHERE user_id = ?').bind(userId).first<Record<string, unknown>>()
const callRow = (userId: string, id: string) => env.DB.prepare('SELECT * FROM ai_calls WHERE user_id = ? AND id = ?').bind(userId, id).first<Record<string, unknown>>()
const callCount = async (userId: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ?').bind(userId).first<{ n: number }>())!.n
const oai = (content: string, finish = 'stop') => Response.json({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 5 } })

/** A ready account: a keyed default model, a note, a 6 o'clock schedule. */
async function ready(over: Parameters<typeof addSchedule>[1] = {}) {
  const a = await account()
  await addModel(a)
  await addNote(a.id, `NOTE-OF-${a.id}`)
  await addSchedule(a.id, over)
  return a
}
const stub = () => {
  const started: { userId: string; callId: string; scheduled?: boolean }[] = []
  return { started, start: async (_e: Env, p: { userId: string; callId: string; scheduled?: boolean }) => { started.push(p) } }
}

describe('zone arithmetic', () => {
  it('reads the local day and hour in a zone, across the date line', () => {
    expect(localParts(NOW, ZONE)).toEqual({ day: '2026-10-17', hour: 7 })
    expect(localParts(NOW, 'Pacific/Auckland')).toEqual({ day: '2026-10-18', hour: 0 })
    expect(validZone(ZONE)).toBe(true)
    expect(validZone('Mars/Olympus')).toBe(false)
    expect(validZone(42)).toBe(false)
  })
})

describe('the tick (D-132)', () => {
  it('known positive: a due schedule with a default model and a note starts one run, and records the claim', async () => {
    const a = await ready()
    const s = stub()
    const r = await runSchedules(env, NOW, s.start)
    expect(r.started).toBeGreaterThanOrEqual(1)
    const mine = s.started.filter((p) => p.userId === a.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.scheduled).toBe(true)
    expect(await schedule(a.id)).toMatchObject({ last_day: '2026-10-17', last_call_id: mine[0]!.callId })
    expect(await callRow(a.id, mine[0]!.callId)).toMatchObject({ status: 'pending', stage: 'harness', model_id: 'm1' })
  })

  it('negative controls: nothing starts when it is off, paused, early, done today, or has no default model', async () => {
    const cases: [string, () => Promise<{ id: string }>][] = [
      ['off', () => ready({ enabled: 0 })],
      ['auto-paused', () => ready({ paused: 'key_rejected' })],
      ['before its hour', () => ready({ hour: 8 })],
      ['already ran today', () => ready({ lastDay: '2026-10-17' })],
      ['no model', async () => { const a = await account(); await addNote(a.id, 'x'); await addSchedule(a.id); return a }],
    ]
    for (const [why, make] of cases) {
      const a = await make()
      const s = stub()
      await runSchedules(env, NOW, s.start)
      expect(s.started.filter((p) => p.userId === a.id), why).toHaveLength(0)
      expect(await callCount(a.id), why).toBe(0)
    }
  })

  it('the operator switch stops every account (D-129)', async () => {
    const a = await ready()
    const s = stub()
    const r = await runSchedules({ ...env, SCHEDULES_PAUSED: 'true' } as Env, NOW, s.start)
    expect(r.started).toBe(0)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(0)
  })

  it('A12(d): two ticks for the same hour start one run', async () => {
    const a = await ready()
    const s = stub()
    await Promise.all([runSchedules(env, NOW, s.start), runSchedules(env, NOW, s.start)])
    await runSchedules(env, NOW + 600_000, s.start)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(1)
  })

  it('A12(e): a tick skips while the earlier reply waits unstored, and runs again once it is stored', async () => {
    const a = await ready()
    const s = stub()
    await runSchedules(env, NOW, s.start)
    const first = s.started.find((p) => p.userId === a.id)!
    await env.DB.prepare("UPDATE ai_calls SET status = 'ok', reply = ?, header = '{}', finished_at = ? WHERE user_id = ? AND id = ?").bind(REPLY, NOW, a.id, first.callId).run()
    await env.DB.prepare('UPDATE schedules SET last_day = ? WHERE user_id = ?').bind('2026-10-16', a.id).run() // a new day has come
    await runSchedules(env, NOW, s.start)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(1) // skipped: no call, no cost
    expect(await callCount(a.id)).toBe(1)
    await env.DB.prepare('UPDATE ai_calls SET reply = NULL, reply_cleared_at = ? WHERE user_id = ? AND id = ?').bind(NOW, a.id, first.callId).run()
    await runSchedules(env, NOW, s.start)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(2)
  })

  it('counts toward the same daily cap, and a refused start releases the claim (D-130)', async () => {
    const a = await ready()
    const capped = { ...env, AI_DAILY_CAP: '0' } as Env // 0 falls back to 30: fill the day instead
    for (let i = 0; i < 30; i++) {
      await env.DB.prepare("INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, status, started_at) VALUES (?, ?, 'm1', 'harness', 'r', 0, 0, 'ok', ?)").bind(a.id, `c${i}`, NOW - 1000).run()
    }
    const s = stub()
    await runSchedules(capped, NOW, s.start)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(0)
    expect(await schedule(a.id)).toMatchObject({ last_day: null, last_call_id: null })
  })

  it('a Workflow that will not start releases the claim, so the next hour tries again', async () => {
    const a = await ready()
    await runSchedules(env, NOW, async () => { throw new Error('boom') })
    expect(await schedule(a.id)).toMatchObject({ last_day: null, last_call_id: null })
    const s = stub()
    await runSchedules(env, NOW + 3_600_000, s.start)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(1)
  })
})

describe('the compose step (D-133) and A12(c)', () => {
  it("composes from the schedule's own account only: B's run never carries A's notes", async () => {
    const a = await ready()
    const b = await ready()
    const s = stub()
    await runSchedules(env, NOW, s.start)
    for (const who of [a, b]) {
      const p = s.started.find((x) => x.userId === who.id)!
      expect(await composeScheduled(env, p, NOW)).toBe('ready')
      const row = await callRow(who.id, p.callId)
      const other = who === a ? b : a
      expect(row!.prompt as string).toContain(`NOTE-OF-${who.id}`) // known positive
      expect(row!.prompt as string).not.toContain(`NOTE-OF-${other.id}`)
      expect(row!.header as string).not.toContain(`NOTE-OF-`) // ids and times only (D-87)
      expect(JSON.parse(row!.header as string)).toMatchObject({ stage: 'harness', runId: p.callId })
    }
  })

  it('an account with nothing to assess ends empty: no call, no failure counted', async () => {
    const a = await account()
    await addModel(a)
    await addSchedule(a.id)
    const s = stub()
    await runSchedules(env, NOW, s.start)
    const p = s.started.find((x) => x.userId === a.id)!
    expect(await composeScheduled(env, p, NOW)).toBe('empty')
    expect(await callRow(a.id, p.callId)).toMatchObject({ status: 'empty', prompt: null })
    expect(await settleSchedule(env, p)).toBe('empty')
    expect(await schedule(a.id)).toMatchObject({ fail_count: 0, paused_reason: null })
  })

  it('end to end without a Workflow: a due run leaves a reply waiting that the device reads, then stores', async () => {
    const a = await ready()
    const s = stub()
    await runSchedules(env, NOW, s.start)
    const p = s.started.find((x) => x.userId === a.id)!
    expect(await composeScheduled(env, p, NOW)).toBe('ready')
    expect(await runCall(env, p, async () => oai(REPLY))).toBe('ok')
    expect(await settleSchedule(env, p)).toBe('ok')
    const res = await call(a.token, '/me/schedules/waiting')
    const body = (await res.json()) as { waiting: { callId: string; reply: string; header: { runId: string } }[] }
    expect(body.waiting).toHaveLength(1)
    expect(body.waiting[0]).toMatchObject({ callId: p.callId, reply: REPLY })
    expect((await call(a.token, `/ai/calls/${p.callId}`, { method: 'PATCH', body: JSON.stringify({ stored: true }) })).status).toBe(200)
    expect(((await (await call(a.token, '/me/schedules/waiting')).json()) as { waiting: unknown[] }).waiting).toHaveLength(0)
  })

  it("B's waiting list never shows A's reply", async () => {
    const a = await ready()
    const b = await account()
    const s = stub()
    await runSchedules(env, NOW, s.start)
    const p = s.started.find((x) => x.userId === a.id)!
    await composeScheduled(env, p, NOW)
    await runCall(env, p, async () => oai(REPLY))
    expect(((await (await call(b.token, '/me/schedules/waiting')).json()) as { waiting: unknown[] }).waiting).toHaveLength(0)
  })
})

describe('failure and pause (D-128)', () => {
  async function runOnce(a: { id: string }, status: 'ok' | 'key_rejected', reply = REPLY) {
    const p = { userId: a.id, callId: crypto.randomUUID() }
    await env.DB.prepare('UPDATE schedules SET last_call_id = ? WHERE user_id = ?').bind(p.callId, a.id).run()
    await env.DB.prepare("INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, status, reply, started_at, finished_at) VALUES (?, ?, 'm1', 'harness', 'r', 0, 0, ?, ?, ?, ?)")
      .bind(a.id, p.callId, status, status === 'ok' ? reply : null, NOW, NOW).run()
    return settleSchedule(env, p)
  }

  it(`${FAILS_TO_PAUSE} technical failures in a row pause the schedule with the reason; a success resets the count`, async () => {
    const a = await ready()
    await runOnce(a, 'key_rejected')
    await runOnce(a, 'key_rejected')
    expect(await schedule(a.id)).toMatchObject({ fail_count: 2, paused_reason: null })
    await runOnce(a, 'ok')
    expect(await schedule(a.id)).toMatchObject({ fail_count: 0, paused_reason: null })
    for (let i = 0; i < FAILS_TO_PAUSE; i++) await runOnce(a, 'key_rejected')
    expect(await schedule(a.id)).toMatchObject({ fail_count: FAILS_TO_PAUSE, paused_reason: 'key_rejected' })
    const s = stub()
    await runSchedules(env, NOW, s.start)
    expect(s.started.filter((p) => p.userId === a.id)).toHaveLength(0) // paused: no more calls
  })

  it('a reply that does not parse counts as a failure and is not left waiting for a device', async () => {
    const a = await ready()
    expect(await runOnce(a, 'ok', 'sorry, no JSON here')).toBe('bad_request')
    expect(await schedule(a.id)).toMatchObject({ fail_count: 1 })
    expect(((await (await call(a.token, '/me/schedules/waiting')).json()) as { waiting: unknown[] }).waiting).toHaveLength(0)
  })

  it('a stale run does not count against the schedule', async () => {
    const a = await ready()
    const old = { userId: a.id, callId: crypto.randomUUID() }
    await env.DB.prepare("INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, status, started_at) VALUES (?, ?, 'm1', 'harness', 'r', 0, 0, 'key_rejected', ?)").bind(a.id, old.callId, NOW).run()
    await settleSchedule(env, old) // the schedule's last_call_id is not this call
    expect(await schedule(a.id)).toMatchObject({ fail_count: 0 })
  })
})

describe('/me/schedules', () => {
  it('requires a session', async () => {
    expect((await app.fetch(new Request(`${API}/me/schedules`), env)).status).toBe(401)
    expect((await app.fetch(new Request(`${API}/me/schedules/waiting`), env)).status).toBe(401)
  })

  it('creates, validates, changes, and lets turning it on clear a pause', async () => {
    const a = await account()
    const put = (body: unknown) => call(a.token, '/me/schedules/morning', { method: 'PUT', body: JSON.stringify(body) })
    expect((await put({ hour: 24, zone: ZONE })).status).toBe(400)
    expect((await put({ hour: 6, zone: 'Mars/Olympus' })).status).toBe(400)
    expect((await put({ hour: 6 })).status).toBe(400) // a new schedule needs a zone
    expect((await put({ hour: 6, zone: ZONE, enabled: 'yes' })).status).toBe(400)
    const made = await put({ hour: 7, zone: ZONE })
    expect(made.status).toBe(200)
    expect(await made.json()).toMatchObject({ kind: 'morning', hour: 7, zone: ZONE, enabled: true, pausedReason: null })
    await env.DB.prepare("UPDATE schedules SET paused_reason = 'refused', fail_count = 3 WHERE user_id = ?").bind(a.id).run()
    expect(await (await put({ hour: 7 })).json()).toMatchObject({ pausedReason: 'refused', failCount: 3 }) // changing the hour is not an answer to the pause
    expect(await (await put({ enabled: false })).json()).toMatchObject({ enabled: false })
    expect(await (await put({ enabled: true })).json()).toMatchObject({ enabled: true, pausedReason: null, failCount: 0 })
    const list = (await (await call(a.token, '/me/schedules')).json()) as { schedules: unknown[]; operatorPaused: boolean }
    expect(list.schedules).toHaveLength(1)
    expect(list.operatorPaused).toBe(false)
  })

  it("never reads or changes another account's schedule", async () => {
    const a = await account()
    const b = await account()
    await addSchedule(a.id, { hour: 5 })
    await call(b.token, '/me/schedules/morning', { method: 'PUT', body: JSON.stringify({ hour: 9, zone: ZONE }) })
    expect(await schedule(a.id)).toMatchObject({ hour: 5 })
    expect(((await (await call(b.token, '/me/schedules')).json()) as { schedules: { hour: number }[] }).schedules.map((s) => s.hour)).toEqual([9])
  })
})
