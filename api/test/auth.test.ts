import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

const API = 'https://api.test'
const RETURN_TO = 'https://app.test/planner/'
const NONCE = 'n'.repeat(24)

// Stands in for GitHub: token exchange, /user, /user/emails. Anything else fails loudly.
function stubGitHub(email: string, userId = 101) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gh-access' })
    if (url === 'https://api.github.com/user') return Response.json({ id: userId, login: 'octo', name: 'Octo' })
    if (url === 'https://api.github.com/user/emails') return Response.json([{ email, primary: true, verified: true }])
    throw new Error(`unexpected outbound fetch: ${url}`)
  })
}

/** Runs /auth/start then /auth/callback the way a browser would, carrying the flow cookie between them. */
async function signIn(opts: { state?: string } = {}) {
  const start = await app.fetch(
    new Request(`${API}/auth/start/github?return_to=${encodeURIComponent(RETURN_TO)}&nonce=${NONCE}`),
    env,
  )
  expect(start.status).toBe(302)
  const cookie = start.headers.get('Set-Cookie')!.split(';')[0]
  const state = opts.state ?? new URL(start.headers.get('Location')!).searchParams.get('state')!
  return app.fetch(
    new Request(`${API}/auth/callback/github?code=c0de&state=${state}`, { headers: { Cookie: cookie } }),
    env,
  )
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n

afterEach(() => vi.restoreAllMocks())

describe('sign-in gate', () => {
  it('signs in an allowlisted email: token + echoed nonce in the fragment, one user, one session', async () => {
    stubGitHub('owner@example.com')
    const res = await signIn()
    expect(res.status).toBe(302)
    const back = new URL(res.headers.get('Location')!)
    expect(back.origin + back.pathname).toBe(RETURN_TO)
    const frag = new URLSearchParams(back.hash.slice(1))
    expect(frag.get('nonce')).toBe(NONCE)

    const me = await app.fetch(new Request(`${API}/me`, { headers: { Authorization: `Bearer ${frag.get('token')}` } }), env)
    expect(await me.json()).toMatchObject({ email: 'owner@example.com' })
    expect(await count('users')).toBe(1)
    expect(await count('sessions')).toBe(1)
  })

  // Negative control (H1 §10 "Invite gate"): provider says yes, the allowlist says no → nothing is created.
  it('refuses an email that is not invited and writes nothing', async () => {
    stubGitHub('stranger@example.com')
    const res = await signIn()
    expect(res.status).toBe(403)
    expect(await count('users')).toBe(0)
    expect(await count('identities')).toBe(0)
    expect(await count('sessions')).toBe(0)
  })

  it('rejects a callback whose state does not match the flow cookie', async () => {
    stubGitHub('owner@example.com')
    const res = await signIn({ state: 'forged-state' })
    expect(res.status).toBe(400)
    expect(await count('users')).toBe(0)
  })
})
