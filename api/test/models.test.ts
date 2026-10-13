// H5 S1 — /me/models (H5-MODELS §6, D-79, D-84). Each "never" is paired with proof that the thing exists to leak or to
// change: a sealed key in D1 before asserting no response carries it; an owner who can, before asserting a stranger cannot.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createSession } from '../src/auth'
import { openKey, sealKey } from '../src/keyBox'
import { cleanBaseUrl } from '../src/modelRules'
import app from '../src/index'

const API = 'https://api.test'
const KEY = 'sk-live-THIS-IS-THE-SECRET-1234'

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}
const call = (token: string | null, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(init.headers ?? {}) } }), env)
const model = (over: Record<string, unknown> = {}) => ({
  label: 'Gemini', format: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-3.1-flash-lite', maxTokens: 16000, ...over,
})
const put = (token: string, id: string, body: Record<string, unknown>) => call(token, `/me/models/${id}`, { method: 'PUT', body: JSON.stringify(body) })
const row = (userId: string, id: string) =>
  env.DB.prepare('SELECT * FROM models WHERE user_id = ? AND id = ?').bind(userId, id).first<{ key_ct: string | null; key_iv: string | null; base_url: string; key_hint: string | null }>()

describe('PUT /me/models/:id', () => {
  it('stores the key sealed, and no response ever carries it', async () => {
    const a = await account('a@example.com')
    const res = await put(a.token, 'm1', model({ key: KEY }))
    expect(res.status).toBe(200)
    const r = (await row(a.id, 'm1'))!
    expect(r.key_ct).toBeTruthy() // exercised: there is a key to leak
    expect(r.key_ct).not.toContain(KEY)
    expect(r.base_url).toBe('https://generativelanguage.googleapis.com/v1beta/openai') // trailing slash normalised
    expect(await openKey(env.MODEL_KEY_SECRET, r.key_ct!, r.key_iv!, a.id, 'm1', r.base_url)).toBe(KEY) // it really is the key
    for (const text of [await res.text(), await (await call(a.token, '/me/models')).text()]) {
      expect(text).not.toContain(KEY)
      expect(text).not.toContain(r.key_ct!)
      expect(text).toContain('"hasKey":true')
      expect(text).toContain('"keyHint":"1234"')
    }
  })

  it('keeps the key on an edit that keeps the endpoint; clears it when format or base URL change', async () => {
    const a = await account('a@example.com')
    await put(a.token, 'm1', model({ key: KEY }))
    const sealed = (await row(a.id, 'm1'))!.key_ct
    expect((await put(a.token, 'm1', model({ label: 'Renamed', model: 'gemini-3.5-flash' }))).status).toBe(200)
    expect((await row(a.id, 'm1'))!.key_ct).toBe(sealed) // label and model id changed: key kept

    await put(a.token, 'm1', model({ baseUrl: 'https://evil.example.net/v1' }))
    expect((await row(a.id, 'm1'))!).toMatchObject({ key_ct: null, key_iv: null, key_hint: null }) // D-84
    await put(a.token, 'm1', model({ key: KEY }))
    expect((await row(a.id, 'm1'))!.key_ct).toBeTruthy()
    await put(a.token, 'm1', model({ format: 'anthropic-messages' }))
    expect((await row(a.id, 'm1'))!.key_ct).toBeNull()
  })

  it('a sealed key does not open for another endpoint, row or account (associated data)', async () => {
    const s = await sealKey(env.MODEL_KEY_SECRET, KEY, 'u1', 'm1', 'https://a.example.com')
    expect(await openKey(env.MODEL_KEY_SECRET, s.ct, s.iv, 'u1', 'm1', 'https://a.example.com')).toBe(KEY) // known positive
    expect(await openKey(env.MODEL_KEY_SECRET, s.ct, s.iv, 'u1', 'm1', 'https://b.example.com')).toBeNull()
    expect(await openKey(env.MODEL_KEY_SECRET, s.ct, s.iv, 'u1', 'm2', 'https://a.example.com')).toBeNull()
    expect(await openKey(env.MODEL_KEY_SECRET, s.ct, s.iv, 'u2', 'm1', 'https://a.example.com')).toBeNull()
  })

  it('refuses endpoints a key must not go to', async () => {
    expect(cleanBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1') // known positive
    for (const bad of [
      'http://api.example.com/v1', 'https://user:pw@api.example.com', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://localhost/v1',
      'https://x.localhost/v1', 'https://intranet/v1', 'https://api.example.com/v1?x=1', 'https://api.example.com:8443/v1', 'not a url',
    ]) expect(cleanBaseUrl(bad), bad).toBeNull()
    const a = await account('a@example.com')
    expect((await put(a.token, 'm1', model({ baseUrl: 'https://10.0.0.1/v1', key: KEY }))).status).toBe(400)
    expect(await row(a.id, 'm1')).toBeNull()
  })

  it('refuses a partial body, bad fields and an 11th model', async () => {
    const a = await account('a@example.com')
    const { label: _drop, ...noLabel } = model()
    for (const body of [noLabel, model({ format: 'gpt' }), model({ maxTokens: 10 }), model({ model: 'has space' }), model({ key: 'short' })]) {
      expect((await put(a.token, 'm1', body)).status, JSON.stringify(body)).toBe(400)
    }
    for (let i = 0; i < 10; i++) expect((await put(a.token, `m${i}`, model())).status).toBe(200)
    expect((await put(a.token, 'm10', model())).status).toBe(409)
    expect((await put(a.token, 'm3', model({ label: 'edit of an existing one' }))).status).toBe(200) // editing is not adding
  })

  it('answers 503 and stores nothing when the secret is missing', async () => {
    const a = await account('a@example.com')
    const res = await app.fetch(
      new Request(`${API}/me/models/m1`, { method: 'PUT', body: JSON.stringify(model({ key: KEY })), headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' } }),
      { ...env, MODEL_KEY_SECRET: undefined },
    )
    expect(res.status).toBe(503)
    expect(await row(a.id, 'm1')).toBeNull()
  })
})

describe('isolation (A11)', () => {
  it('another account cannot read, edit, delete or test a model', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    await put(a.token, 'm1', model({ key: KEY }))
    expect((await (await call(a.token, '/me/models')).json() as { models: unknown[] }).models).toHaveLength(1) // known positive
    expect((await (await call(b.token, '/me/models')).json() as { models: unknown[] }).models).toHaveLength(0)
    expect((await call(b.token, '/me/models/m1', { method: 'DELETE' })).status).toBe(404)
    expect((await call(b.token, '/me/models/m1/test', { method: 'POST' })).status).toBe(404)
    await put(b.token, 'm1', model({ label: 'B’s own' })) // same id, B's own row
    expect((await row(a.id, 'm1'))!.key_ct).toBeTruthy() // A's untouched
    expect((await call(a.token, '/me/models/m1', { method: 'DELETE' })).status).toBe(200)
    expect(await row(a.id, 'm1')).toBeNull()
    expect(await row(b.id, 'm1')).not.toBeNull()
  })

  it('needs a signed-in caller', async () => {
    expect((await call(null, '/me/models')).status).toBe(401)
    expect((await call(null, '/me/models/m1', { method: 'PUT', body: JSON.stringify(model()) })).status).toBe(401)
  })
})
