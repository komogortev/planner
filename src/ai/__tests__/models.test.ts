import { describe, expect, it, vi } from 'vitest'
import { awaitCall, GEMINI_KEY_URL, getCall, listModels, ModelsError, outcomeText, presetOf, PRESETS, saveModel, startCall, type CallStatus, type CallView } from '../models'

const API = 'https://api.test'
const view = (status: CallStatus, over: Partial<CallView> = {}): CallView => ({
  id: 'c1', modelId: 'm1', stage: 'harness', runId: 'r1', status, stop: null, tokensIn: null, tokensOut: null,
  reply: status === 'ok' ? '{"tasks":[]}' : null, replyCleared: false, startedAt: 0, finishedAt: null, ...over,
})
const client = (fetchImpl: typeof fetch) => ({ fetchImpl, apiUrl: API, token: 'tok' })

describe('Worker client', () => {
  it('sends the bearer token and JSON; the key goes in the save body only', async () => {
    const f = vi.fn(async () => Response.json({ id: 'm1', hasKey: true, keyHint: '1234' }))
    await saveModel('m1', { label: 'G', format: 'openai-chat', baseUrl: 'https://x.example.com/v1', model: 'g', maxTokens: 16000, key: 'sk-secret-1234' }, client(f))
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API}/me/models/m1`)
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toMatchObject({ key: 'sk-secret-1234' })
    expect(String(url)).not.toContain('sk-secret')
  })

  it('turns failures into one readable message', async () => {
    const fail = (status: number, body: unknown = {}) => client(async () => Response.json(body, { status }))
    await expect(listModels(fail(503))).rejects.toThrow('Models are not set up on the server yet.')
    await expect(listModels(fail(401))).rejects.toThrow('Signed out. Sign in again.')
    await expect(listModels(fail(400, { error: 'baseUrl: an https address' }))).rejects.toThrow('baseUrl: an https address')
    await expect(listModels(client(async () => { throw new TypeError('offline') }))).rejects.toThrow('No connection to the server.')
    await expect(listModels({ fetchImpl: vi.fn(), apiUrl: API, token: null })).rejects.toMatchObject({ status: 401 })
  })

  it('starts a call with the run’s ids', async () => {
    const f = vi.fn(async () => Response.json({ id: 'c1', status: 'pending' }, { status: 202 }))
    expect(await startCall({ modelId: 'm1', stage: 'harness', runId: 'r1', prompt: 'P', entryCount: 3 }, client(f))).toMatchObject({ id: 'c1' })
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ modelId: 'm1', stage: 'harness', runId: 'r1', prompt: 'P', entryCount: 3 })
  })
})

describe('awaitCall', () => {
  it('polls until the call is no longer pending', async () => {
    const answers = [view('pending'), view('pending'), view('ok')]
    const f = vi.fn(async () => Response.json(answers.shift()))
    const sleep = vi.fn(async () => {})
    const out = await awaitCall('c1', { client: client(f), sleep })
    expect(out.status).toBe('ok')
    expect(f).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up past its deadline as lost, and stops on abort', async () => {
    const f = vi.fn(async () => Response.json(view('pending')))
    expect((await awaitCall('c1', { client: client(f), sleep: async () => {}, timeoutMs: -1 })).status).toBe('lost')
    const ac = new AbortController()
    ac.abort()
    await expect(awaitCall('c1', { client: client(f), signal: ac.signal })).rejects.toBeTruthy()
  })

  it('rides out network blips and 5xx; a 404 ends the wait at once', async () => {
    const answers: (() => Response)[] = [
      () => { throw new TypeError('offline') },
      () => Response.json({ error: 'x' }, { status: 502 }),
      () => Response.json(view('pending')),
      () => Response.json(view('ok')),
    ]
    const f = vi.fn(async () => answers.shift()!())
    expect((await awaitCall('c1', { client: client(f), sleep: async () => {} })).status).toBe('ok')
    expect(f).toHaveBeenCalledTimes(4)
    const gone = vi.fn(async () => Response.json({ error: 'not found' }, { status: 404 }))
    await expect(awaitCall('c1', { client: client(gone), sleep: async () => {} })).rejects.toMatchObject({ status: 404 })
    expect(gone).toHaveBeenCalledTimes(1)
    const down = vi.fn(async () => { throw new TypeError('offline') })
    await expect(awaitCall('c1', { client: client(down), sleep: async () => {} })).rejects.toMatchObject({ status: null })
    expect(down).toHaveBeenCalledTimes(7) // the first try plus POLL_RETRIES
  })

  it('an abort mid-sleep rejects at once', async () => {
    const ac = new AbortController()
    const f = vi.fn(async () => Response.json(view('pending')))
    const p = awaitCall('c1', { client: client(f), signal: ac.signal, intervalMs: 60_000 })
    await new Promise((r) => setTimeout(r, 10))
    ac.abort()
    await expect(p).rejects.toBeTruthy()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a failed read is an error, not a finished call', async () => {
    await expect(getCall('c1', client(async () => Response.json({ error: 'not found' }, { status: 404 })))).rejects.toBeInstanceOf(ModelsError)
  })
})

describe('presets and wording', () => {
  it('maps a saved endpoint back to its preset, anything else to custom', () => {
    const g = PRESETS.find((p) => p.id === 'gemini')!
    expect(presetOf({ format: g.format, baseUrl: g.baseUrl }).id).toBe('gemini')
    expect(presetOf({ format: 'openai-chat', baseUrl: 'https://llm.example.com/v1' }).id).toBe('custom')
    expect(g.note).toMatch(/free tier/) // the preset says where the notes go (H5-S1-SPIKE §5)
    expect(g.note).toMatch(/people at Google may read it/) // Google's terms: human review on unpaid quota (2026-10-14)
    expect(GEMINI_KEY_URL).toBe('https://aistudio.google.com/apikey') // the help panel's link, from Google's key page
    expect(g.model).toBe('gemini-3.1-flash-lite')
  })

  it('every outcome has its own line', () => {
    const all: CallStatus[] = ['pending', 'ok', 'cut_off', 'refused', 'key_rejected', 'rate_limited', 'model_not_found', 'model_unavailable', 'provider_down', 'bad_request', 'no_key', 'lost']
    const lines = all.map(outcomeText)
    expect(new Set(lines).size).toBe(all.length)
    expect(outcomeText('model_unavailable')).toMatch(/Pick another model/) // D-92
  })
})
