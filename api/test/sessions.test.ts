// D-22 — /me/sessions. Each "cannot" is paired with proof the thing exists and the owner can: a second account's session
// is in D1 before asserting the first never sees or ends it; a revoked token worked before it is refused.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createSession, deviceLabel, renewSession, authenticate } from '../src/auth'
import app from '../src/index'

const API = 'https://api.test'

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return id
}
const call = (token: string | null, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }), env)
type Listed = { id: string; device: string | null; createdAt: number; lastSeenAt: number; current: boolean }
const list = async (token: string) => ((await (await call(token, '/me/sessions')).json()) as { sessions: Listed[] }).sessions
const sessionCount = async (userId: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(userId).first<{ n: number }>())!.n

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36', 'Samsung Internet on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on macOS'],
    ['curl/8.0', null],
    [undefined, null],
  ])('%s → %s', (ua, label) => expect(deviceLabel(ua)).toBe(label))
})

describe('GET /me/sessions', () => {
  it('lists the caller’s live sessions, this one first and marked, with device and times; never a token or a whole hash', async () => {
    const a = await account('a@example.com')
    const phone = await createSession(env.DB, a, 'Chrome on Android')
    const desk = await createSession(env.DB, a, 'Edge on Windows')
    const res = await call(desk, '/me/sessions')
    expect(res.status).toBe(200)
    const text = await res.text()
    const { sessions } = JSON.parse(text) as { sessions: Listed[] }
    expect(sessions.map((s) => [s.device, s.current])).toEqual([['Edge on Windows', true], ['Chrome on Android', false]])
    expect(sessions.every((s) => s.id.length === 16 && s.lastSeenAt >= s.createdAt)).toBe(true)
    const hashes = (await env.DB.prepare('SELECT token_hash FROM sessions').all<{ token_hash: string }>()).results.map((r) => r.token_hash)
    expect(hashes).toHaveLength(2) // known positive: the full hashes exist to leak
    for (const secret of [phone, desk, ...hashes]) expect(text).not.toContain(secret)
  })

  it('never lists another account’s sessions, nor expired ones', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const tokenA = await createSession(env.DB, a)
    await createSession(env.DB, b, 'Firefox on Linux')
    expect(await sessionCount(b)).toBe(1) // known positive: b's session is there
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('expired-hash-0000000000', ?, 1, 2)").bind(a).run()
    expect((await list(tokenA)).map((s) => s.current)).toEqual([true])
  })

  it('a session from before 0010 lists with no device and its creation time as last seen', async () => {
    const a = await account('a@example.com')
    const token = await createSession(env.DB, a)
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('old-session-hash-000000', ?, 5, 9e15)").bind(a).run()
    const old = (await list(token)).find((s) => !s.current)!
    expect(old).toMatchObject({ device: null, createdAt: 5, lastSeenAt: 5 })
  })

  it('needs a signed-in caller', async () => {
    expect((await call(null, '/me/sessions')).status).toBe(401)
  })
})

describe('signing out other devices', () => {
  it('DELETE /me/sessions/:id ends that device: its token worked before and is refused after', async () => {
    const a = await account('a@example.com')
    const phone = await createSession(env.DB, a, 'Chrome on Android')
    const desk = await createSession(env.DB, a, 'Edge on Windows')
    expect((await call(phone, '/me')).status).toBe(200) // known positive
    const target = (await list(desk)).find((s) => !s.current)!
    expect((await call(desk, `/me/sessions/${target.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(phone, '/me')).status).toBe(401)
    expect((await call(desk, '/me')).status).toBe(200)
    expect((await call(desk, `/me/sessions/${target.id}`, { method: 'DELETE' })).status).toBe(404) // already gone
  })

  it('refuses this device (Sign out does that) and a malformed id', async () => {
    const a = await account('a@example.com')
    const token = await createSession(env.DB, a)
    const [me] = await list(token)
    expect((await call(token, `/me/sessions/${me.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await call(token, '/me/sessions/x%25', { method: 'DELETE' })).status).toBe(400)
    expect(await sessionCount(a)).toBe(1)
  })

  it('another account’s session cannot be ended, even by its id (negative control: its owner can)', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const tokenA = await createSession(env.DB, a)
    const tokenB = await createSession(env.DB, b)
    const tokenB2 = await createSession(env.DB, b)
    const bId = (await list(tokenB2)).find((s) => !s.current)!.id
    expect((await call(tokenA, `/me/sessions/${bId}`, { method: 'DELETE' })).status).toBe(404)
    expect((await call(tokenB, '/me')).status).toBe(200)
    expect((await call(tokenB2, `/me/sessions/${bId}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(tokenB, '/me')).status).toBe(401)
  })

  it('POST /me/sessions/others ends every other device of the caller only, and keeps this one', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const keep = await createSession(env.DB, a)
    const other1 = await createSession(env.DB, a)
    const other2 = await createSession(env.DB, a)
    const tokenB = await createSession(env.DB, b)
    const res = await call(keep, '/me/sessions/others', { method: 'POST' })
    expect(await res.json()).toEqual({ signedOut: 2 })
    for (const t of [other1, other2]) expect((await call(t, '/me')).status).toBe(401)
    expect((await call(keep, '/me')).status).toBe(200)
    expect((await call(tokenB, '/me')).status).toBe(200)
    expect(await (await call(keep, '/me/sessions/others', { method: 'POST' })).json()).toEqual({ signedOut: 0 })
  })
})

describe('last seen', () => {
  it('moves on renewal (at most daily), not on every request', async () => {
    const a = await account('a@example.com')
    const token = await createSession(env.DB, a)
    await env.DB.prepare('UPDATE sessions SET last_seen_at = 1, expires_at = ? WHERE user_id = ?').bind(Date.now() + 86_400_000, a).run()
    const s = (await authenticate(env.DB, `Bearer ${token}`))!
    await renewSession(env.DB, s)
    expect((await list(token))[0].lastSeenAt).toBeGreaterThan(1)
  })
})
