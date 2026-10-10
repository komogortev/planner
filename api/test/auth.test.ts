import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

const API = 'https://api.test'
const RETURN_TO = 'https://app.test/planner/'
const NONCE = 'n'.repeat(24)
const DAY = 86_400_000

type GitHubUser = { id: number; emails: string[] }
type GoogleUser = { sub: string; email: string }

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Stands in for both providers. Anything else the Worker fetches fails the test.
function stubProviders(gh: GitHubUser | null, google: GoogleUser | null = null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (gh && url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gh-access' })
    if (gh && url === 'https://api.github.com/user') return Response.json({ id: gh.id, login: 'octo', name: 'Octo' })
    if (gh && url === 'https://api.github.com/user/emails') {
      return Response.json(gh.emails.map((email, i) => ({ email, primary: i === 0, verified: true })))
    }
    if (google && url === 'https://oauth2.googleapis.com/token') {
      const claims = {
        iss: 'https://accounts.google.com', aud: 'google-test-id', exp: Date.now() / 1000 + 600,
        sub: google.sub, email: google.email, email_verified: true, name: 'G',
      }
      return Response.json({ id_token: `${b64url({ alg: 'none' })}.${b64url(claims)}.sig` })
    }
    throw new Error(`unexpected outbound fetch: ${url}`)
  })
}

/** /auth/start then /auth/callback the way a browser would, carrying the flow cookie. Returns the callback response. */
async function signIn(provider: 'github' | 'google' = 'github', opts: { state?: string } = {}) {
  const start = await app.fetch(
    new Request(`${API}/auth/start/${provider}?return_to=${encodeURIComponent(RETURN_TO)}&nonce=${NONCE}`),
    env,
  )
  expect(start.status).toBe(302)
  const cookie = start.headers.get('Set-Cookie')!.split(';')[0]
  const state = opts.state ?? new URL(start.headers.get('Location')!).searchParams.get('state')!
  return app.fetch(
    new Request(`${API}/auth/callback/${provider}?code=c0de&state=${state}`, { headers: { Cookie: cookie } }),
    env,
  )
}

function tokenOf(res: Response): string {
  expect(res.status).toBe(302)
  const frag = new URLSearchParams(new URL(res.headers.get('Location')!).hash.slice(1))
  expect(frag.get('nonce')).toBe(NONCE)
  return frag.get('token')!
}

const me = (token: string) => app.fetch(new Request(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } }), env)

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n

const invite = (email: string, expiresAt = Date.now() + 7 * DAY) =>
  env.DB.prepare('INSERT INTO invites (email, created_at, expires_at) VALUES (?, ?, ?)').bind(email, Date.now(), expiresAt).run()

afterEach(() => vi.restoreAllMocks())

describe('invite gate', () => {
  it('creates the account for an invited email and consumes the invite', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const token = tokenOf(await signIn())

    expect(await (await me(token)).json()).toMatchObject({ email: 'owner@example.com' })
    expect(await count('users')).toBe(1)
    expect(await env.DB.prepare('SELECT used_by IS NOT NULL AS used FROM invites').first()).toEqual({ used: 1 })
  })

  // Negative control (H1 §10 "Invite gate"): the provider says yes, no invite → nothing is created.
  it('refuses an email with no invite and writes nothing', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 102, emails: ['stranger@example.com'] })
    expect((await signIn()).status).toBe(403)
    expect([await count('users'), await count('identities'), await count('sessions')]).toEqual([0, 0, 0])
  })

  it('refuses an expired invite and writes nothing', async () => {
    await invite('late@example.com', Date.now() - 1)
    stubProviders({ id: 103, emails: ['late@example.com'] })
    expect((await signIn()).status).toBe(403)
    expect(await count('users')).toBe(0)
  })

  it('takes the invited address when the provider reports several', async () => {
    await invite('work@example.com')
    stubProviders({ id: 104, emails: ['primary@example.com', 'work@example.com'] })
    tokenOf(await signIn())
    expect(await env.DB.prepare('SELECT email FROM users').first()).toEqual({ email: 'work@example.com' })
  })

  it('lets an existing account sign in again with its invite already used', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    tokenOf(await signIn())
    tokenOf(await signIn())
    expect([await count('users'), await count('sessions')]).toEqual([1, 2])
  })

  it('links a second provider with the same verified email to the same account', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] }, { sub: 'g-1', email: 'owner@example.com' })
    tokenOf(await signIn('github'))
    tokenOf(await signIn('google'))
    expect([await count('users'), await count('identities')]).toEqual([1, 2])
  })

  it('rejects a callback whose state does not match the flow cookie', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    expect((await signIn('github', { state: 'forged-state' })).status).toBe(400)
    expect(await count('users')).toBe(0)
  })
})

describe('sessions', () => {
  async function signedIn() {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    return tokenOf(await signIn())
  }

  it('a disabled (revoked) account: existing token stops working, sign-in is refused', async () => {
    const token = await signedIn()
    await env.DB.prepare('UPDATE users SET disabled_at = ?').bind(Date.now()).run()
    expect((await me(token)).status).toBe(401)
    expect((await signIn()).status).toBe(403)
  })

  // The email-link path must refuse a disabled account too: a new provider with the same email gets nothing.
  it('a disabled account cannot be reached by linking a second provider', async () => {
    await signedIn()
    await env.DB.prepare('UPDATE users SET disabled_at = ?').bind(Date.now()).run()
    stubProviders(null, { sub: 'g-1', email: 'owner@example.com' })
    expect((await signIn('google')).status).toBe(403)
    expect([await count('identities'), await count('sessions')]).toEqual([1, 1])
  })

  // Production's shape: an account from the S1 allowlist era — user + identity, no invite row at all.
  it('an account with no invite row signs in by its linked identity', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'owner@example.com', 'Owner', 1)"),
      env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('github', '101', 'u1')"),
    ])
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    expect(await (await me(tokenOf(await signIn()))).json()).toMatchObject({ id: 'u1' })
    expect(await count('invites')).toBe(0)
  })

  it('logout ends that session only', async () => {
    const a = await signedIn()
    const b = tokenOf(await signIn())
    const out = await app.fetch(new Request(`${API}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${a}` } }), env)
    expect(out.status).toBe(204)
    expect((await me(a)).status).toBe(401)
    expect((await me(b)).status).toBe(200)
  })

  it('purges the account’s expired sessions at sign-in', async () => {
    await signedIn()
    await env.DB.prepare('UPDATE sessions SET expires_at = 1').run()
    tokenOf(await signIn())
    expect(await count('sessions')).toBe(1)
  })
})
