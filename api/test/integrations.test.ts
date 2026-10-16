// GitHub bridge G1 — /me/integrations/github (docs/GITHUB-BRIDGE.md §4, D-121). Each "never" is paired with proof that the
// thing exists to leak or to change: a sealed token in D1 before asserting no response carries it; an owner's row that
// exists before asserting a stranger cannot see or remove it; a GitHub call that really happened before "nothing stored".
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/auth'
import { githubToken, parseExpiry } from '../src/integrations'
import app from '../src/index'

const API = 'https://api.test'
const TOKEN = 'github_pat_11AAAAAAA0THIS_IS_THE_SECRET_TOKEN_9z8y'

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}
const call = (token: string | null, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(init.headers ?? {}) } }), env)
const connect = (session: string, token: string) => call(session, '/me/integrations/github', { method: 'PUT', body: JSON.stringify({ token }) })
const rows = async (userId: string) => ((await env.DB.prepare('SELECT COUNT(*) AS n FROM integrations WHERE user_id = ?').bind(userId).first<{ n: number }>())!.n)

/** GitHub's /user, answering for `login`; `status` other than 200 answers that status instead. */
function github(opts: { login?: string; status?: number; expiry?: string } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    opts.status && opts.status !== 200
      ? Response.json({ message: 'Bad credentials' }, { status: opts.status })
      : Response.json({ login: opts.login ?? 'octo' }, { headers: opts.expiry ? { 'github-authentication-token-expiration': opts.expiry } : {} }))
}
afterEach(() => vi.restoreAllMocks())

describe('PUT /me/integrations/github', () => {
  it('stores the token sealed, and no response ever carries it', async () => {
    const a = await account('a@example.com')
    const gh = github({ login: 'octo', expiry: '2026-11-15 12:00:00 UTC' })
    const res = await connect(a.token, TOKEN)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    expect(await res.json()).toEqual({
      provider: 'github', connected: true, login: 'octo', keyHint: TOKEN.slice(-4), expiresAt: Date.UTC(2026, 10, 15, 12),
      createdAt: expect.any(Number), updatedAt: expect.any(Number),
    })
    // GitHub was asked with the pasted token, and the stored row really holds it (exercised: something exists to leak).
    const [url, init] = gh.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/user')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    const row = (await env.DB.prepare('SELECT key_ct FROM integrations WHERE user_id = ?').bind(a.id).first<{ key_ct: string }>())!
    expect(await githubToken(env, a.id)).toBe(TOKEN)
    // Not in the PUT answer, the GET answer or the export.
    for (const t of [text, await (await call(a.token, '/me/integrations/github')).text(), await (await call(a.token, '/me/export')).text()]) {
      expect(t).not.toContain(TOKEN)
      expect(t).not.toContain(row.key_ct)
    }
  })

  it('refuses a token GitHub rejects, and stores nothing', async () => {
    const a = await account('a@example.com')
    const gh = github({ status: 401 })
    const res = await connect(a.token, TOKEN)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/rejected/)
    expect(gh).toHaveBeenCalledTimes(1) // exercised: GitHub was really asked
    expect(await rows(a.id)).toBe(0)
  })

  it('refuses a classic token before asking GitHub', async () => {
    const a = await account('a@example.com')
    const gh = github()
    const res = await connect(a.token, 'ghp_' + 'a'.repeat(36))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/fine-grained/)
    expect(gh).not.toHaveBeenCalled()
    expect(await rows(a.id)).toBe(0)
  })

  it('answers 502 and stores nothing when GitHub cannot be reached', async () => {
    const a = await account('a@example.com')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new TypeError('network down') })
    expect((await connect(a.token, TOKEN)).status).toBe(502)
    expect(await rows(a.id)).toBe(0)
  })

  it('answers 502 for any other GitHub status and stores nothing; a token with no expiry stores null', async () => {
    const a = await account('a@example.com')
    for (const status of [403, 500, 302]) {
      vi.restoreAllMocks()
      github({ status })
      expect((await connect(a.token, TOKEN)).status, String(status)).toBe(502)
    }
    expect(await rows(a.id)).toBe(0)
    vi.restoreAllMocks()
    github({ login: 'octo' }) // no expiry header
    expect(((await (await connect(a.token, TOKEN)).json()) as { expiresAt: unknown }).expiresAt).toBeNull()
  })

  it('answers 502 when GitHub names no login, and 400 for a body that is not JSON', async () => {
    const a = await account('a@example.com')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ id: 1 }))
    expect((await connect(a.token, TOKEN)).status).toBe(502)
    expect((await call(a.token, '/me/integrations/github', { method: 'PUT', body: 'not json' })).status).toBe(400)
    expect(await rows(a.id)).toBe(0)
  })

  it('answers 503 and stores nothing when the Worker has no key secret', async () => {
    const a = await account('a@example.com')
    github()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await app.fetch(new Request(`${API}/me/integrations/github`, {
      method: 'PUT', body: JSON.stringify({ token: TOKEN }), headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    }), { ...env, MODEL_KEY_SECRET: undefined })
    expect(res.status).toBe(503)
    expect(await rows(a.id)).toBe(0)
  })

  it('replaces the token on a second connect, still one row', async () => {
    const a = await account('a@example.com')
    github({ login: 'octo' })
    await connect(a.token, TOKEN)
    const second = TOKEN.replace('9z8y', 'NEW1')
    const res = await connect(a.token, second)
    expect(((await res.json()) as { keyHint: string; expiresAt: number | null }).keyHint).toBe('NEW1')
    expect(await rows(a.id)).toBe(1)
    expect(await githubToken(env, a.id)).toBe(second)
  })

  it('needs a session', async () => {
    expect((await call(null, '/me/integrations/github')).status).toBe(401)
    expect((await connect('not-a-session', TOKEN)).status).toBe(401)
  })
})

describe('isolation and removal', () => {
  it("B never sees, reads or removes A's connection", async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    github({ login: 'a-login' })
    await connect(a.token, TOKEN)
    expect(await rows(a.id)).toBe(1) // exercised: A's row exists
    expect(await (await call(b.token, '/me/integrations/github')).json()).toEqual({ provider: 'github', connected: false })
    expect(await githubToken(env, b.id)).toBeNull()
    expect(await (await call(b.token, '/me/integrations/github', { method: 'DELETE' })).json()).toEqual({ deleted: false })
    expect(await rows(a.id)).toBe(1)
  })

  it('a ciphertext copied to another account does not decrypt there', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    github()
    await connect(a.token, TOKEN)
    await env.DB.prepare(
      `INSERT INTO integrations (user_id, provider, key_ct, key_iv, key_hint, key_version, login, expires_at, created_at, updated_at)
       SELECT ?, provider, key_ct, key_iv, key_hint, key_version, login, expires_at, created_at, updated_at FROM integrations WHERE user_id = ?`,
    ).bind(b.id, a.id).run()
    expect(await githubToken(env, a.id)).toBe(TOKEN) // known positive
    expect(await githubToken(env, b.id)).toBeNull()
  })

  it('Remove deletes the row, and delete-account does too', async () => {
    const a = await account('a@example.com')
    github()
    await connect(a.token, TOKEN)
    expect(await (await call(a.token, '/me/integrations/github', { method: 'DELETE' })).json()).toEqual({ deleted: true })
    expect(await rows(a.id)).toBe(0)
    await connect(a.token, TOKEN)
    expect(await rows(a.id)).toBe(1)
    const me = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(a.id).first<{ email: string }>()
    expect((await call(a.token, '/me', { method: 'DELETE', body: JSON.stringify({ confirm: me!.email }) })).status).toBe(200)
    expect(await rows(a.id)).toBe(0)
  })
})

describe('parseExpiry', () => {
  it('reads UTC and offset forms, and gives null for no header or an unreadable one', () => {
    expect(parseExpiry('2026-11-15 12:00:00 UTC')).toBe(Date.UTC(2026, 10, 15, 12))
    expect(parseExpiry('2026-11-15 12:00:00 +0100')).toBe(Date.UTC(2026, 10, 15, 11))
    expect(parseExpiry('2026-11-15 12:00:00 -0500')).toBe(Date.UTC(2026, 10, 15, 17))
    expect(parseExpiry(null)).toBeNull()
    expect(parseExpiry('soon')).toBeNull()
    expect(parseExpiry('2026-13-45 12:00:00 UTC')).toBeNull()
  })
})
