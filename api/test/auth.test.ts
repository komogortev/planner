import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

const API = 'https://api.test'
const RETURN_TO = 'https://app.test/planner/'
const NONCE = 'n'.repeat(24)
const DAY = 86_400_000

type GitHubUser = { id: number; emails: string[]; verified?: boolean }
type GoogleUser = { sub: string; email: string; hd?: string }

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Stands in for both providers. Anything else the Worker fetches fails the test.
function stubProviders(gh: GitHubUser | null, google: GoogleUser | null = null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (gh && url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gh-access' })
    if (gh && url === 'https://api.github.com/user') return Response.json({ id: gh.id, login: 'octo', name: 'Octo' })
    if (gh && url === 'https://api.github.com/user/emails') {
      return Response.json(gh.emails.map((email, i) => ({ email, primary: i === 0, verified: gh.verified ?? true })))
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

/**
 * A refusal as the app receives it (D-57): a redirect back to the app with `#error=<code>&…` in the fragment — never a text
 * page on the API origin, where an installed PWA has no way back. A refusal never carries a token.
 */
function refusalOf(res: Response) {
  expect(res.status).toBe(302)
  const to = new URL(res.headers.get('Location')!)
  expect(`${to.origin}${to.pathname}`).toBe(RETURN_TO)
  const frag = new URLSearchParams(to.hash.slice(1))
  expect(frag.get('token')).toBeNull()
  return { code: frag.get('error'), nonce: frag.get('nonce'), params: Object.fromEntries(frag) }
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
    // The refusal names what the provider reported, so the person knows which address to ask an invite for.
    expect(refusalOf(await signIn())).toMatchObject({ code: 'not-invited', nonce: NONCE, params: { p: 'github', emails: 'stranger@example.com' } })
    expect([await count('users'), await count('identities'), await count('sessions')]).toEqual([0, 0, 0])
  })

  it('refuses an expired invite and writes nothing', async () => {
    await invite('late@example.com', Date.now() - 1)
    stubProviders({ id: 103, emails: ['late@example.com'] })
    expect(refusalOf(await signIn()).code).toBe('not-invited')
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
    // No flow cookie to read the nonce from: the refusal still goes back to the app (the first allowed URL), without one.
    expect(refusalOf(await signIn('github', { state: 'forged-state' }))).toMatchObject({ code: 'expired', nonce: null })
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
    expect(refusalOf(await signIn()).code).toBe('disabled')
  })

  // The email-link path must refuse a disabled account too: a new provider with the same email gets nothing.
  it('a disabled account cannot be reached by linking a second provider', async () => {
    await invite('owner@gmail.com') // Gmail: Google vouches for it, so only `disabled_at` can be what refuses this
    stubProviders({ id: 101, emails: ['owner@gmail.com'] }, { sub: 'g-1', email: 'owner@gmail.com' })
    tokenOf(await signIn())
    await env.DB.prepare('UPDATE users SET disabled_at = ?').bind(Date.now()).run()
    expect(refusalOf(await signIn('google')).code).toBe('disabled')
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
    expect(refusalOf(await finishFlow(jar, other)).code).toBe('expired')
    expect(refusalOf(await finishFlow(jar, 'short')).code).toBe('expired')
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
    expect(refusalOf(await finishFlow(jar, states[0])).code).toBe('expired') // dropped
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
        // Google reported an address it cannot vouch for: the app is told which one, and to use another provider.
        expect(refusalOf(res)).toMatchObject({ code: 'not-invited', params: { p: 'google', unvouched: email.toLowerCase() } })
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
    expect(refusalOf(await signIn('google')).code).toBe('not-invited')
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
    const r = refusalOf(await signIn('google'))
    expect(r.code).toBe('disabled')
    expect(r.params.unvouched).toBeUndefined() // not "sent to another provider": the account is revoked, whatever the address
    expect(await count('sessions')).toBe(0)
  })

  it('a provider that will not take the code is reported as such', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: 'bad_verification_code' }))
    expect(refusalOf(await signIn()).code).toBe('provider')
  })

  // The provider sends the person back without a code when they decline on its consent screen.
  it('a person who declines at the provider is told so, with the nonce so the app can trust it', async () => {
    stubProviders({ id: 108, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    const { state } = await startFlow(jar)
    const res = await app.fetch(new Request(`${API}/auth/callback/github?error=access_denied&state=${state}`, { headers: { Cookie: cookieHeader(jar) } }), env)
    expect(refusalOf(res)).toMatchObject({ code: 'cancelled', nonce: NONCE })
    expect(await count('sessions')).toBe(0)
    // The flow's cookie is used up by a refusal too, not only by a success.
    const del = res.headers.getSetCookie().find((c: string) => c.startsWith(`oauth_flow_${state}=`) && /Max-Age=0/i.test(c))
    expect(del).toBeTruthy()
  })

  // Review finding: every provider-side failure used to read "cancelled".
  it('a provider error that is not a decline is a provider failure; no code and no error is a decline', async () => {
    stubProviders({ id: 108, emails: ['owner@example.com'] })
    const jar: Jar = new Map()
    const { state } = await startFlow(jar)
    const go = (qs: string) => app.fetch(new Request(`${API}/auth/callback/github?${qs}state=${state}`, { headers: { Cookie: cookieHeader(jar) } }), env)
    expect(refusalOf(await go('error=server_error&')).code).toBe('provider')
    const again = await startFlow(jar)
    const bare = await app.fetch(new Request(`${API}/auth/callback/github?state=${again.state}`, { headers: { Cookie: cookieHeader(jar) } }), env)
    expect(refusalOf(bare).code).toBe('cancelled')
  })

  // What the provider reports is the person's own address, but it passes through a URL: it must stay one parameter.
  it('an address with URL syntax in it stays inside its own parameter', async () => {
    const evil = 'x&token=evil&nonce=zz#y@example.com'
    stubProviders({ id: 109, emails: [evil] })
    const r = refusalOf(await signIn()) // refusalOf also fails if the fragment carries a token
    expect(r.params.emails).toBe(evil)
    expect(r.params.token).toBeUndefined()
    expect(r.nonce).toBe(NONCE)
  })

  it('a failure on our side still goes back to the app (not a bare error page)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new TypeError('network down') })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(refusalOf(await signIn())).toMatchObject({ code: 'server', nonce: NONCE })
    expect(await count('sessions')).toBe(0)
  })

  it('a provider with no verified address is reported as such', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 105, emails: ['owner@example.com'], verified: false })
    expect(refusalOf(await signIn()).code).toBe('no-verified-email')
    expect(await count('users')).toBe(0)
  })

  it('what the refusal carries is bounded: at most three addresses, none over 120 characters', async () => {
    const long = `${'x'.repeat(150)}@example.com`
    stubProviders({ id: 106, emails: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', long] })
    const r = refusalOf(await signIn())
    expect(r.params.emails!.split(',')).toEqual(['a@example.com', 'b@example.com', 'c@example.com'])
    stubProviders({ id: 107, emails: [long] })
    expect(refusalOf(await signIn()).params.emails ?? '').toBe('')
  })
})

describe('where the browser is sent back to', () => {
  // The flow cookie is httpOnly and written by this Worker, but its returnTo is read back on the callback: it is checked
  // against the allow-list again, so a forged one can neither receive the token nor be the target of a refusal.
  async function callbackWithCookie(returnTo: string, withEnv: typeof env = env) {
    const state = 'a'.repeat(43)
    const flow = { p: 'github', state, verifier: 'v'.repeat(43), returnTo, nonce: NONCE, at: Date.now() }
    return app.fetch(
      new Request(`${API}/auth/callback/github?code=c0de&state=${state}`, { headers: { Cookie: `oauth_flow_${state}=${encodeURIComponent(JSON.stringify(flow))}` } }),
      withEnv,
    )
  }

  // Two origins live at once (docs/ORIGIN-MOVE.md phases 1–3): the second one is accepted, a lookalike is not.
  const TWO = { ...env, ALLOWED_APP_URLS: `${RETURN_TO},https://new.test/` }
  it('a second allowed origin receives the sign-in; the first stays the fallback', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const res = await callbackWithCookie('https://new.test/signin', TWO)
    expect(res.headers.get('Location')!.startsWith('https://new.test/signin#')).toBe(true)
  })

  it('a lookalike of the second origin gets the first URL, never the token', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    for (const forged of ['https://new.test.evil.example/', 'https://new.testx/', 'http://new.test/']) {
      const res = await callbackWithCookie(forged, TWO)
      const to = new URL(res.headers.get('Location')!)
      expect(`${to.origin}${to.pathname}`, forged).toBe(RETURN_TO)
    }
  })

  // Known positive: a legitimate deeper path under the allowed prefix is kept, so the two refusals below are not just "always the first URL".
  it('keeps the page the app asked to come back to', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const res = await callbackWithCookie(`${RETURN_TO}signin`)
    expect(res.headers.get('Location')!.startsWith(`${RETURN_TO}signin#`)).toBe(true)
  })

  it('a forged returnTo does not receive the token: the first allowed app URL does', async () => {
    await invite('owner@example.com')
    stubProviders({ id: 101, emails: ['owner@example.com'] })
    const res = await callbackWithCookie('https://evil.example/steal')
    const to = new URL(res.headers.get('Location')!)
    expect(`${to.origin}${to.pathname}`).toBe(RETURN_TO)
    expect(new URLSearchParams(to.hash.slice(1)).get('nonce')).toBe(NONCE) // the app checks it, and rejects a token it did not ask for
  })

  it('a forged returnTo is not the target of a refusal either', async () => {
    stubProviders({ id: 102, emails: ['stranger@example.com'] })
    expect(refusalOf(await callbackWithCookie('https://evil.example/steal')).code).toBe('not-invited')
  })

  // Review finding: the allow-list check ran on the raw string and the redirect on the parsed one — `…/planner/../x` starts
  // with the allowed prefix as text and is another page once parsed (on a shared Pages host, another site).
  const BS = String.fromCharCode(92) // a backslash: URL parsers treat it as a slash
  for (const climb of ['../other/', '%2e%2e/other/', `..${BS}other${BS}`, '.%2E/other/']) {
    it(`a returnTo that climbs out of the allowed path (${climb}) is not followed, token or refusal`, async () => {
      await invite('owner@example.com')
      stubProviders({ id: 101, emails: ['owner@example.com'] })
      const signedIn = await callbackWithCookie(`${RETURN_TO}${climb}`)
      const to = new URL(signedIn.headers.get('Location')!)
      expect(`${to.origin}${to.pathname}`).toBe(RETURN_TO)
      expect(new URLSearchParams(to.hash.slice(1)).get('token')).toBeTruthy() // exercised: it is the sign-in that was redirected
      stubProviders({ id: 102, emails: ['stranger@example.com'] })
      expect(refusalOf(await callbackWithCookie(`${RETURN_TO}${climb}`)).code).toBe('not-invited')
    })
  }

  // Known positive for the refusal path: it is not simply "always the first URL".
  it('a refusal goes back to the page the app asked for, when that is allowed', async () => {
    stubProviders({ id: 102, emails: ['stranger@example.com'] })
    const res = await callbackWithCookie(`${RETURN_TO}signin`)
    expect(res.headers.get('Location')!.startsWith(`${RETURN_TO}signin#error=`)).toBe(true)
  })
})
