// H5 S1 — /ai/calls, the provider adapters and the Workflow every call runs in (H5-MODELS §4, D-85, D-88, D-91, D-92).
// No real provider is reached: `runCall` takes a fetch stub, and the Workflow test stubs the global fetch.
import { env, introspectWorkflowInstance } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOST_AFTER_MS, REPLY_KEEP_MS, runCall, UNCLAIMED_LOST_MS } from '../src/aiCalls'
import { createSession } from '../src/auth'
import { buildRequest, callModel, errorStatus, readAnswer, UNAVAILABLE_FAST_MS } from '../src/providers'
import app from '../src/index'

const API = 'https://api.test'
const KEY = 'sk-live-THIS-IS-THE-SECRET-1234'

afterEach(() => vi.restoreAllMocks())

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}
const call = (token: string | null, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(init.headers ?? {}) } }), env)
async function withModel(format: 'openai-chat' | 'anthropic-messages' = 'openai-chat', key: string | null = KEY) {
  const a = await account(`${crypto.randomUUID()}@example.com`)
  const baseUrl = format === 'openai-chat' ? 'https://llm.example.com/v1' : 'https://api.anthropic.com/v1'
  const res = await call(a.token, '/me/models/m1', { method: 'PUT', body: JSON.stringify({ label: 'M', format, baseUrl, model: 'm-1', maxTokens: 4000, ...(key ? { key } : {}) }) })
  expect(res.status).toBe(200)
  return a
}
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ modelId: 'm1', stage: 'harness', runId: 'run-1', prompt: 'NOTES: buy milk', entryCount: 1, ...over })
/** A pending call row as POST would write it, without starting a Workflow (for runCall tests). */
async function pending(userId: string, prompt = 'NOTES: buy milk') {
  const id = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, prompt, status, started_at)
    VALUES (?, ?, 'm1', 'harness', 'run-1', 1, ?, ?, 'pending', ?)`).bind(userId, id, prompt.length, prompt, Date.now()).run()
  return id
}
const callRow = (userId: string, id: string) => env.DB.prepare('SELECT * FROM ai_calls WHERE user_id = ? AND id = ?').bind(userId, id).first<Record<string, unknown>>()
const oai = (content: string, finish = 'stop') => Response.json({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 5 } })

describe('provider adapters', () => {
  it('builds each format’s request; the key goes only in its header', () => {
    const o = buildRequest({ format: 'openai-chat', baseUrl: 'https://llm.example.com/v1', model: 'm', maxTokens: 100 }, KEY, 'hi')
    expect(o.url).toBe('https://llm.example.com/v1/chat/completions')
    expect((o.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(o.init.body as string)).toEqual({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    const oa = buildRequest({ format: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: 'm', maxTokens: 100 }, KEY, 'hi')
    expect(JSON.parse(oa.init.body as string)).toHaveProperty('max_completion_tokens', 100)
    const an = buildRequest({ format: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5', maxTokens: 100 }, KEY, 'hi')
    expect(an.url).toBe('https://api.anthropic.com/v1/messages')
    expect(an.init.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' })
    expect(an.init.body as string).not.toContain(KEY)
  })

  it('reads answers: text, usage, cut-off (D-85), refusal; never guesses an unreadable one', () => {
    expect(readAnswer('openai-chat', { choices: [{ message: { content: '{"tasks":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }))
      .toEqual({ status: 'ok', stop: 'stop', tokensIn: 3, tokensOut: 4, text: '{"tasks":[]}' })
    expect(readAnswer('openai-chat', { choices: [{ message: { content: '{"tas' }, finish_reason: 'length' }] })).toMatchObject({ status: 'cut_off', text: '' })
    expect(readAnswer('openai-chat', { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })).toMatchObject({ status: 'refused' })
    const thinking = { type: 'thinking', thinking: '' }
    expect(readAnswer('anthropic-messages', { content: [thinking, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 2 } }))
      .toEqual({ status: 'ok', stop: 'end_turn', tokensIn: 9, tokensOut: 2, text: 'ab' })
    expect(readAnswer('anthropic-messages', { content: [{ type: 'text', text: '{"t' }], stop_reason: 'max_tokens' })).toMatchObject({ status: 'cut_off', text: '' })
    expect(readAnswer('anthropic-messages', { content: [], stop_reason: 'refusal' })).toMatchObject({ status: 'refused' })
    for (const junk of [null, 'x', [], { choices: [] }, { choices: [{ message: {}, finish_reason: 'stop' }] }]) expect(readAnswer('openai-chat', junk).status).toBe('bad_request')
    expect(readAnswer('openai-chat', { choices: [{ message: {} }] })).toMatchObject({ status: 'cut_off', text: '' }) // no finish reason: not finished
    expect(readAnswer('anthropic-messages', { stop_reason: 'end_turn' }).status).toBe('bad_request')
  })

  it('only a known "finished" stop reason keeps text: any other spelling of a truncation is cut off', () => {
    const o = (finish: string | null) => readAnswer('openai-chat', { choices: [{ message: { content: '{"t' }, finish_reason: finish }] })
    expect(o('stop').status).toBe('ok') // known positive
    for (const f of ['model_length', 'max_tokens', null, 'whatever']) expect(o(f), String(f)).toMatchObject({ status: 'cut_off', text: '' })
    const a = (stop: string | null) => readAnswer('anthropic-messages', { content: [{ type: 'text', text: '{"t' }], stop_reason: stop })
    expect(a('end_turn').status).toBe('ok')
    expect(a('stop_sequence').status).toBe('ok')
    for (const s of ['model_context_window_exceeded', 'pause_turn', null]) expect(a(s), String(s)).toMatchObject({ status: 'cut_off', text: '' })
  })

  it('never follows a redirect: the key stays with the registered host', () => {
    for (const format of ['openai-chat', 'anthropic-messages'] as const) {
      expect(buildRequest({ format, baseUrl: 'https://llm.example.com/v1', model: 'm', maxTokens: 10 }, KEY, 'hi').init.redirect).toBe('manual')
    }
    expect(errorStatus(302, 100)).toBe('bad_request')
  })

  it('maps HTTP failures by status and speed only (D-88, D-92)', () => {
    expect(errorStatus(401, 100)).toBe('key_rejected')
    expect(errorStatus(403, 100)).toBe('key_rejected')
    expect(errorStatus(404, 100)).toBe('model_not_found')
    expect(errorStatus(429, 100)).toBe('rate_limited')
    expect(errorStatus(503, UNAVAILABLE_FAST_MS - 1)).toBe('model_unavailable')
    expect(errorStatus(503, UNAVAILABLE_FAST_MS + 1)).toBe('provider_down') // a 503 mid-reply is an overload (spike D)
    expect(errorStatus(529, 100)).toBe('provider_down')
    expect(errorStatus(400, 100)).toBe('bad_request')
  })

  it('a network error is provider_down, not a throw', async () => {
    const out = await callModel({ format: 'openai-chat', baseUrl: 'https://llm.example.com/v1', model: 'm', maxTokens: 10 }, KEY, 'hi', async () => { throw new TypeError('network') })
    expect(out.status).toBe('provider_down')
  })
})

describe('runCall (the Workflow step’s work)', () => {
  it('stores the reply and usage, clears the prompt', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    const stub = vi.fn(async () => oai('{"tasks":[]}'))
    expect(await runCall(env, { userId: a.id, callId: id }, stub)).toBe('ok')
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://llm.example.com/v1/chat/completions')
    expect(init.headers).toMatchObject({ authorization: `Bearer ${KEY}` }) // the sealed key really opened
    expect(await callRow(a.id, id)).toMatchObject({ status: 'ok', reply: '{"tasks":[]}', tokens_in: 12, tokens_out: 5, prompt: null })
  })

  it('a cut-off reply keeps no text (D-85)', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    expect(await runCall(env, { userId: a.id, callId: id }, async () => oai('{"tasks":[{"text":"buy', 'length'))).toBe('cut_off')
    expect(await callRow(a.id, id)).toMatchObject({ status: 'cut_off', reply: null, stop: 'length', prompt: null })
  })

  it('a throw anywhere in the call still clears the prompt, then rethrows', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    const exploding = async () => ({ ok: false, status: 500, body: { cancel: () => Promise.reject(new Error('stream broke')) } }) as unknown as Response
    await expect(runCall(env, { userId: a.id, callId: id }, exploding)).rejects.toThrow('stream broke')
    expect(await callRow(a.id, id)).toMatchObject({ status: 'lost', prompt: null })
  })

  it('runs once: a replayed step does not call the provider again', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    const stub = vi.fn(async () => oai('{"tasks":[]}'))
    await runCall(env, { userId: a.id, callId: id }, stub)
    expect(await runCall(env, { userId: a.id, callId: id }, stub)).toBe('ok')
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('two step executions at once: one provider call; the second finds the row claimed and calls nobody', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    let releaseFirst!: () => void
    let firstCalled!: () => void
    const inFlight = new Promise<void>((r) => { firstCalled = r })
    const first = runCall(env, { userId: a.id, callId: id }, () => new Promise((r) => { firstCalled(); releaseFirst = () => r(oai('{"first":1}')) }))
    await inFlight // the first execution has claimed the row and is waiting on the provider
    expect(await callRow(a.id, id)).toMatchObject({ status: 'calling' })
    const secondStub = vi.fn(async () => oai('{"second":2}'))
    expect(await runCall(env, { userId: a.id, callId: id }, secondStub)).toBe('calling')
    expect(secondStub).not.toHaveBeenCalled() // never a second bill
    releaseFirst()
    expect(await first).toBe('ok')
    expect(await callRow(a.id, id)).toMatchObject({ status: 'ok', reply: '{"first":1}' })
  })

  it('a provider error that echoes the key reaches no response, no row and no log (D-88)', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn')]
    const echo = async () => Response.json({ error: { message: `Incorrect API key provided: ${KEY}` } }, { status: 401 })
    expect(await runCall(env, { userId: a.id, callId: id }, echo)).toBe('key_rejected')
    const r = await callRow(a.id, id)
    expect(r).toMatchObject({ status: 'key_rejected' }) // exercised: the error path ran
    expect(JSON.stringify(r)).not.toContain(KEY)
    expect(await (await call(a.token, `/ai/calls/${id}`)).text()).not.toContain(KEY)
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY)
  })

  it('no key, a deleted model or a key sealed for another endpoint → no_key, and no provider call', async () => {
    const a = await withModel()
    const stub = vi.fn(async () => oai('x'))
    await env.DB.prepare("UPDATE models SET base_url = 'https://other.example.com/v1' WHERE user_id = ?").bind(a.id).run() // moved under the seal
    expect(await runCall(env, { userId: a.id, callId: await pending(a.id) }, stub)).toBe('no_key')
    await env.DB.prepare('DELETE FROM models WHERE user_id = ?').bind(a.id).run()
    expect(await runCall(env, { userId: a.id, callId: await pending(a.id) }, stub)).toBe('no_key')
    expect(stub).not.toHaveBeenCalled()
  })
})

describe('POST /ai/calls', () => {
  it('starts a Workflow that calls the model and stores the reply; the device reads it, then marks it stored', async () => {
    const a = await withModel()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input instanceof Request ? input.url : input) === 'https://llm.example.com/v1/chat/completions') return oai('{"tasks":[]}')
      throw new Error(`unexpected outbound fetch: ${String(input)}`)
    })
    const res = await call(a.token, '/ai/calls', { method: 'POST', body: body() })
    expect(res.status).toBe(202)
    const { id, status } = (await res.json()) as { id: string; status: string }
    expect(status).toBe('pending')
    const wf = await introspectWorkflowInstance(env.MODEL_CALL, id)
    try {
      await wf.waitForStatus('complete')
    } finally {
      await wf.dispose()
    }
    const view = (await (await call(a.token, `/ai/calls/${id}`)).json()) as Record<string, unknown>
    expect(view).toMatchObject({ id, status: 'ok', reply: '{"tasks":[]}', runId: 'run-1', stage: 'harness', replyCleared: false })
    expect(view).not.toHaveProperty('prompt')
    expect((await call(a.token, `/ai/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ stored: true }) })).status).toBe(200)
    expect(await (await call(a.token, `/ai/calls/${id}`)).json()).toMatchObject({ reply: null, replyCleared: true })
  })

  it('refuses bad input, a model with no key, and another account’s model', async () => {
    const a = await withModel()
    for (const over of [{ modelId: 'BAD ID' }, { stage: 'test' }, { runId: '' }, { prompt: '' }, { entryCount: -1 }]) {
      expect((await call(a.token, '/ai/calls', { method: 'POST', body: body(over) })).status, JSON.stringify(over)).toBe(400)
    }
    const big = 'x'.repeat(150_001)
    expect((await call(a.token, '/ai/calls', { method: 'POST', body: body({ prompt: big }) })).status).toBe(413)
    const noKey = await withModel('openai-chat', null)
    expect((await call(noKey.token, '/ai/calls', { method: 'POST', body: body() })).status).toBe(409)
    const b = await account('b@example.com')
    expect((await call(b.token, '/ai/calls', { method: 'POST', body: body() })).status).toBe(404) // A's m1 is not B's
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_calls').first<{ n: number }>())!.n).toBe(0)
  })

  it('stops at the daily cap', async () => {
    const a = await withModel()
    for (let i = 0; i < 30; i++) {
      await env.DB.prepare(`INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, status, started_at)
        VALUES (?, ?, 'm1', 'harness', 'r', 0, 0, 'ok', ?)`).bind(a.id, `c${i}`, Date.now() - 60_000).run()
    }
    const res = await call(a.token, '/ai/calls', { method: 'POST', body: body() })
    expect(res.status).toBe(429)
    expect(await res.text()).toContain('daily cap')
    await env.DB.prepare('UPDATE ai_calls SET started_at = ? WHERE user_id = ? AND id = ?').bind(Date.now() - 86_400_001, a.id, 'c0').run()
    // one call fell out of the 24 h window: the cap no longer refuses (the Workflow is not awaited here)
    expect((await call(a.token, '/ai/calls', { method: 'POST', body: body() })).status).toBe(202)
  })

  it('needs a signed-in caller', async () => {
    expect((await call(null, '/ai/calls', { method: 'POST', body: body() })).status).toBe(401)
  })
})

describe('GET and PATCH /ai/calls/:id', () => {
  it('a call that can no longer finish reads as lost, its prompt cleared; one still in time does not', async () => {
    const a = await withModel()
    const queued = await pending(a.id)
    const running = await pending(a.id)
    const longQueued = await pending(a.id)
    const now = Date.now()
    // `running` was queued a long time, then claimed recently: in time, measured from the claim
    await env.DB.prepare("UPDATE ai_calls SET status = 'calling', started_at = ?, claimed_at = ? WHERE id = ?").bind(now - UNCLAIMED_LOST_MS + 60_000, now - 60_000, running).run()
    await env.DB.prepare('UPDATE ai_calls SET started_at = ? WHERE id = ?').bind(now - UNCLAIMED_LOST_MS - 1, longQueued).run()
    expect(await (await call(a.token, `/ai/calls/${running}`)).json()).toMatchObject({ status: 'pending' }) // `calling` reads as pending
    expect(await (await call(a.token, `/ai/calls/${queued}`)).json()).toMatchObject({ status: 'pending' })
    expect(await callRow(a.id, longQueued)).toMatchObject({ status: 'lost', prompt: null }) // swept by the GETs above
    await env.DB.prepare('UPDATE ai_calls SET claimed_at = ? WHERE id = ?').bind(now - LOST_AFTER_MS - 1, running).run()
    expect(await (await call(a.token, `/ai/calls/${running}`)).json()).toMatchObject({ status: 'lost' })
    expect(await callRow(a.id, running)).toMatchObject({ status: 'lost', prompt: null })
    expect(await callRow(a.id, queued)).toMatchObject({ status: 'pending' }) // still in time
  })

  it('PATCH refuses a running call; a stranger sees nothing', async () => {
    const a = await withModel()
    const id = await pending(a.id)
    expect((await call(a.token, `/ai/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ stored: true }) })).status).toBe(409)
    const b = await account('b@example.com')
    expect((await call(b.token, `/ai/calls/${id}`)).status).toBe(404)
    expect((await call(b.token, `/ai/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ stored: true }) })).status).toBe(404)
  })

  it('replies older than 7 days are cleared on any touch: a start, a read, an export', async () => {
    const a = await withModel()
    const old = (id: string) => env.DB.prepare(`INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, status, reply, started_at, finished_at)
      VALUES (?, ?, 'm1', 'harness', 'r', 0, 0, 'ok', 'old reply', ?, ?)`).bind(a.id, id, Date.now() - REPLY_KEEP_MS - 10, Date.now() - REPLY_KEEP_MS - 5).run()
    for (const [id, touch] of [
      ['o1', () => call(a.token, '/ai/calls', { method: 'POST', body: body() })],
      ['o2', () => call(a.token, '/ai/calls/o2')],
      ['o3', () => call(a.token, '/me/export')],
    ] as const) {
      await old(id)
      expect((await callRow(a.id, id))!.reply, id).toBe('old reply') // exercised
      const res = await touch()
      expect(await res.text(), id).not.toContain('old reply')
      expect(await callRow(a.id, id), id).toMatchObject({ reply: null })
    }
  })
})
