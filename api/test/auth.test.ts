import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

const API = 'https://api.test'
const RETURN_TO = 'https://app.test/planner/'
const NONCE = 'n'.repeat(24)
const DAY = 86_400_000

type GitHubUser = { id: number; emails: string[] }
type GoogleUser = { sub: string; email: string; hd?: string }

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
        sub: google.sub, email: google.email, email_verified: true, name: 'G', ...(google.hd ? { hd: google.hd } : {}),
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
    await invite('owner@gmail.com')
    stubProviders({ id: 101, emails: ['owner@gmail.com'] }, { sub: 'g-1', email: 'owner@gmail.com' })
    tokenOf(await signIn('github'))
    tokenOf(await signIn('google'))
    expect([await count('users'), await count('identities')]).toEqual([1, 2])
  })

  it('rejects a callback with a malformed state', async () => {
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
    await invite('owner@gmail.com') // Gmail: Google vouches for it, so only `disabled_at` can be what refuses this
    stubProviders({ id: 101, emails: ['owner@gmail.com'] }, { sub: 'g-1', email: 'owner@gmail.com' })
    tokenOf(await signIn())
    await env.DB.prepare('UPDATE users SET disabled_at = ?').bind(Date.now()).run()
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

// ── step 6: carried from the S1 review (H1-S1-SPIKE.md §5) ─────────────────────────────────────────────────────────

// A browser identifies a cookie by name AND path, and a deletion only reaches the cookie with the same path: model that,
// so a wrong Path on the deleting Set-Cookie is caught here, not in someone's browser.
type Jar = Map<string, { name: string; value: string; path: string }>
const cookieHeader = (jar: Jar) =>
  [...jar.values()].filter((c) => '/auth/x'.startsWith(c.path)).map((c) => `${c.name}=${c.value}`).join('; ')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One browser: /auth/start with the cookies it holds, then keep (or drop) whatever the response sets. */
async function startFlow(jar: Jar, provider: 'github' | 'google' = 'github') {
  const res = await app.fetch(
    new Request(`${API}/auth/start/${provider}?return_to=${encodeURIComponent(RETURN_TO)}&nonce=${NONCE}`, { headers: { Cookie: cookieHeader(jar) } }),
    env,
  )
  expect(res.status).toBe(302)
  for (const sc of res.headers.getSetCookie()) {
    const [pair, ...attrs] = sc.split(';').map((a) => a.trim())
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq)
    const path = attrs.find((a) => /^path=/i.test(a))?.slice(5) ?? '/'
    if (/Max-Age=0/i.test(sc)) jar.delete(`${path} ${name}`)
    else jar.set(`${path} ${name}`, { name, value: pair.slice(eq + 1), path })
  }
  const location = new URL(res.headers.get('Location')!)
  return { state: location.searchParams.get('state')!, location }
}
const finishFlow = async (jar: Jar, state: string, provider: 'github' | 'google' = 'github') => {
  const res = await app.fetch(new Request(`${API}/auth/callback/${provider}?code=c0de&state=${state}`, { headers: { Cookie: cookieHeader(jar) } }), env)
  for (const sc of res.headers.getSetCookie()) {
    const [pair, ...attrs] = sc.split(';').map((x) => x.trim())
    const name = pair.slice(0, pair.indexOf('='))
    const path = attrs.find((x) => /^path=/i.test(x))?.slice(5) ?? '/'
    if (/Max-Age=0/i.test(sc)) jar.delete(`${path} ${name}`)
  }
  return res
}
const flowCookies = (jar: Jar) => [...jar.values()].map((c) => c.name).filter((k) => k.startsWith('oauth_flow_'))

describe('two sign-ins at once (flow cookie per state)', () => {
  it('two tabs of one browser both finish', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    const a = await startFlow(jar)
    const b = await startFlow(jar)
    expect(flowCookies(jar)).toHaveLength(2) // one cookie each; a single shared name would hold only b's
    tokenOf(await finishFlow(jar, b.state))
    tokenOf(await finishFlow(jar, a.state))
  })

  it('a state that has no cookie of its own is refused, even with another flow\'s cookie present', async () => {
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    await startFlow(jar)
    const other = 'x'.repeat(43)
    expect((await finishFlow(jar, other)).status).toBe(400)
    expect((await finishFlow(jar, 'short')).status).toBe(400)
    expect(await count('users')).toBe(0)
  })

  it('a flow cookie is used once: finishing deletes it', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    const a = await startFlow(jar)
    const done = await finishFlow(jar, a.state)
    const del = done.headers.getSetCookie().find((c: string) => c.startsWith(`oauth_flow_${a.state}=`) && /Max-Age=0/i.test(c))
    expect(del).toBeTruthy()
    expect(del).toMatch(/Path=\/auth(;|$)/i) // must equal the path it was set with, or the browser keeps the cookie
    expect(del).toMatch(/Secure/i)
    expect(flowCookies(jar)).toHaveLength(0) // the jar honours Path, so a wrong one would leave the cookie behind
  })

  // Unfinished sign-ins live 10 minutes; without a cap a loop of /auth/start grows the Cookie header sent to /auth/*.
  // Hono reads cookie names loosely but writes them strictly: deleting a stray name throws, so the prune must never try.
  it('a stray cookie whose name merely starts with oauth_flow_ does not break /auth/start', async () => {
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    for (let i = 0; i < 4; i++) { await startFlow(jar); await wait(5) }
    jar.set('/auth oauth_flow_a@b', { name: 'oauth_flow_a@b', value: '1', path: '/auth' })
    jar.set('/auth oauth_flow_(x)', { name: 'oauth_flow_(x)', value: '{"at":0}', path: '/auth' })
    const res = await startFlow(jar) // 4 real flows + 2 strays + the new one: would have been a 500
    expect(res.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(flowCookies(jar)).toEqual(expect.arrayContaining(['oauth_flow_a@b', 'oauth_flow_(x)'])) // strays left alone
  })

  it('keeps at most 5 unfinished sign-ins, dropping the oldest', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    const states: string[] = []
    for (let i = 0; i < 7; i++) {
      states.push((await startFlow(jar)).state)
      await wait(5) // flows are ordered by when they started
    }
    expect(flowCookies(jar)).toHaveLength(5)
    expect(flowCookies(jar).sort()).toEqual(states.slice(2).map((s) => `oauth_flow_${s}`).sort())
    expect((await finishFlow(jar, states[0])).status).toBe(400) // dropped
    tokenOf(await finishFlow(jar, states[6])) // the newest still works
  })
})

describe('PKCE', () => {
  const sha256b64url = async (v: string) => {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
    return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const tokenRequest = (url: string) => {
    const call = vi.mocked(globalThis.fetch).mock.calls.find(([u]) => String(u) === url)
    return new URLSearchParams(String(call?.[1]?.body))
  }

  for (const [provider, tokenUrl] of [['github', 'https://github.com/login/oauth/access_token'], ['google', 'https://oauth2.googleapis.com/token']] as const) {
    it(`${provider}: the code_verifier sent at the token exchange hashes to the code_challenge sent at the start`, async () => {
      await invite('owner@gmail.com')
      stubProviders({ id: 101, emails: ['owner@gmail.com'] }, { sub: 'g-1', email: 'owner@gmail.com' })
      const jar: Jar = new Map()
      const flow = await startFlow(jar, provider)
      expect(flow.location.searchParams.get('code_challenge_method')).toBe('S256')
      const challenge = flow.location.searchParams.get('code_challenge')!
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)

      tokenOf(await finishFlow(jar, flow.state, provider))
      const verifier = tokenRequest(tokenUrl).get('code_verifier')
      expect(verifier).toBeTruthy()
      expect(await sha256b64url(verifier!)).toBe(challenge)
    })
  }
})

describe('Google email linking', () => {
  // Production's shape: an existing account with a GitHub identity; the question is whether a Google sign-in may join it.
  const existing = (email: string) =>
    env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, 1)').bind('u1', email, 'Owner'),
      env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('github', '101', 'u1')"),
    ])

  // [Google's email, hd claim, may it join the account that has that email?]
  const cases: [string, string | undefined, boolean][] = [
    ['owner@gmail.com', undefined, true],
    ['OWNER@GMAIL.COM', undefined, true],
    ['owner@googlemail.com', undefined, true],
    ['owner@corp.example', 'corp.example', true],
    ['owner@corp.example', 'CORP.example', true],
    ['owner@corp.example', undefined, false], // a verified address Google does not host: the domain may have changed hands
    ['owner@corp.example', 'other.example', false], // hosted domain is not the address's domain
    ['owner@gmail.com.evil.example', undefined, false],
    ['owner@notgmail.com', undefined, false],
  ]
  for (const [email, hd, joins] of cases) {
    it(`${email}${hd ? ` (hd ${hd})` : ''} ${joins ? 'joins' : 'is refused'}`, async () => {
      await existing(email.toLowerCase())
      stubProviders(null, { sub: 'g-1', email, hd })
      const res = await signIn('google')
      if (joins) {
        tokenOf(res)
        expect(await count('identities')).toBe(2)
      } else {
        expect(res.status).toBe(403)
        expect(await res.text()).toContain('cannot vouch for')
        expect([await count('identities'), await count('sessions')]).toEqual([1, 0])
      }
    })
  }

  // Negative control for over-blocking: once linked, the Google account signs in by its own id, whatever its address.
  it('a Google identity already linked still signs in with a non-Gmail address', async () => {
    await existing('owner@corp.example')
    await env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('google', 'g-1', 'u1')").run()
    stubProviders(null, { sub: 'g-1', email: 'owner@corp.example' })
    expect(await (await me(tokenOf(await signIn('google')))).json()).toMatchObject({ id: 'u1' })
  })

  it('an invite for a non-Gmail address is not redeemed by a Google account that cannot vouch for it', async () => {
    await invite('new@corp.example')
    stubProviders(null, { sub: 'g-2', email: 'new@corp.example' })
    expect((await signIn('google')).status).toBe(403)
    expect([await count('users'), await count('identities')]).toEqual([0, 0])
    expect(await env.DB.prepare('SELECT used_by FROM invites').first()).toEqual({ used_by: null })
  })

  it('…but is redeemed by one whose hosted domain is that address\'s domain', async () => {
    await invite('new@corp.example')
    stubProviders(null, { sub: 'g-2', email: 'new@corp.example', hd: 'corp.example' })
    tokenOf(await signIn('google'))
    expect(await count('users')).toBe(1)
  })
})

describe('refusal reasons', () => {
  it('a revoked account on a non-Gmail Google address is told it is disabled, not sent to another provider', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, name, created_at, disabled_at) VALUES ('u1', 'owner@corp.example', 'Owner', 1, 2)"),
      env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('google', 'g-1', 'u1')"),
    ])
    stubProviders(null, { sub: 'g-1', email: 'owner@corp.example' })
    const res = await signIn('google')
    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('disabled')
    expect(text).not.toContain('cannot vouch')
    expect(await count('sessions')).toBe(0)
  })
})
