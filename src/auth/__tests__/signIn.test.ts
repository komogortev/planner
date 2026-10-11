import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkReturn, fetchMe, revokeSession } from '../signIn'

const pending = { nonce: 'n'.repeat(32), provider: 'github' as const, at: 1_000_000 }

describe('checkReturn', () => {
  it('accepts a token whose nonce this app issued', () => {
    expect(checkReturn(`#token=abc&nonce=${pending.nonce}`, pending, pending.at + 5_000)).toEqual({
      ok: true,
      token: 'abc',
      provider: 'github',
    })
  })

  // Login CSRF: a crafted link carries someone else's token and a nonce we never issued.
  it('rejects a token with a different nonce', () => {
    expect(checkReturn('#token=abc&nonce=attacker-chosen-value', pending, pending.at)).toMatchObject({ ok: false })
  })

  it('rejects a token with no nonce at all', () => {
    expect(checkReturn('#token=abc', pending, pending.at)).toMatchObject({ ok: false })
  })

  it('rejects a token when no sign-in was started', () => {
    expect(checkReturn(`#token=abc&nonce=${pending.nonce}`, null, pending.at)).toMatchObject({ ok: false })
  })

  it('rejects a malformed pending entry (null nonce, missing time)', () => {
    const nullNonce = { ...pending, nonce: null } as unknown as typeof pending
    expect(checkReturn('#token=abc', nullNonce, pending.at)).toMatchObject({ ok: false })
    const noTime = { ...pending, at: undefined } as unknown as typeof pending
    expect(checkReturn(`#token=abc&nonce=${pending.nonce}`, noTime, pending.at)).toMatchObject({ ok: false })
  })

  it('rejects a return after the 10-minute window', () => {
    expect(checkReturn(`#token=abc&nonce=${pending.nonce}`, pending, pending.at + 10 * 60_000 + 1)).toMatchObject({
      ok: false,
    })
  })

  it('ignores a fragment that is not a sign-in return', () => {
    expect(checkReturn('', pending, pending.at)).toBeNull()
    expect(checkReturn('#section-2', pending, pending.at)).toBeNull()
  })
})

// The session verdict the app acts on. The launch-time check in Settings used to treat every 401 alike and wipe the
// device; the reason has to survive so the app can tell "deleted elsewhere" (the notes here are the only copy) from "expired".
describe('fetchMe', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      configurable: true,
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

  it('is signed-out without a token, and does not ask the server', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await fetchMe()).toBe('signed-out')
    expect(spy).not.toHaveBeenCalled()
  })

  it('a plain 401 is signed-out', async () => {
    store.set('planner.signIn.token', 'tok')
    answer(401, { error: 'signed out' })
    expect(await fetchMe()).toBe('signed-out')
  })

  it('a 401 that says the account was deleted keeps that reason', async () => {
    store.set('planner.signIn.token', 'tok')
    answer(401, { error: 'signed out', reason: 'account-deleted' })
    expect(await fetchMe()).toBe('account-deleted')
  })

  it('a 200 is the account; a 500 is an error, not a verdict', async () => {
    store.set('planner.signIn.token', 'tok')
    answer(200, { id: 'u1', email: 'a@example.com', name: null })
    expect(await fetchMe()).toEqual({ id: 'u1', email: 'a@example.com', name: null })
    answer(500, { error: 'boom' })
    expect(await fetchMe()).toEqual({ error: 'HTTP 500' })
  })
})

describe('revokeSession', () => {
  it('posts the token to /auth/logout and says whether the server took it', async () => {
    let seen: { url: string; method?: string; auth: string | null } | null = null
    const ok: typeof fetch = async (input, init) => {
      seen = { url: String(input), method: init?.method, auth: new Headers(init?.headers).get('Authorization') }
      return new Response(null, { status: 204 })
    }
    expect(await revokeSession('tok', ok, 'https://api.test')).toBe(true)
    expect(seen).toEqual({ url: 'https://api.test/auth/logout', method: 'POST', auth: 'Bearer tok' })
  })

  it('a network failure is false, never a throw', async () => {
    const down: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
    expect(await revokeSession('tok', down, 'https://api.test')).toBe(false)
  })
})
