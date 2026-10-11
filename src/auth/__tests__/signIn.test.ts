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

// D-57: the Worker sends a refusal back to the app the way it sends a token — `#error=<code>&…`. The app words it.
describe('checkReturn: a refusal from the Worker', () => {
  const frag = (o: Record<string, string>) => `#${new URLSearchParams(o).toString()}`
  const reason = (hash: string, p: typeof pending | null = pending, at = pending.at + 5_000) => {
    const r = checkReturn(hash, p, at)
    expect(r).toMatchObject({ ok: false })
    return (r as { reason: string }).reason
  }

  // Known positive: the refusal reaches the person, so the "ignored" cases below cannot pass on a parser that drops everything.
  it('names the address the provider reported, so the person knows which one to ask an invite for', () => {
    const text = reason(frag({ error: 'not-invited', nonce: pending.nonce, p: 'github', emails: 'a@example.com,b@example.com' }))
    expect(text).toContain('Not invited')
    expect(text).toContain('GitHub')
    expect(text).toContain('a@example.com, b@example.com')
  })

  it('an address Google cannot vouch for says to use another provider', () => {
    const text = reason(frag({ error: 'not-invited', nonce: pending.nonce, p: 'google', unvouched: 'me@corp.example' }))
    expect(text).toContain('Google cannot vouch for me@corp.example')
    expect(text).toContain('Gmail')
  })

  it('every code has its own wording, and an unknown one is a generic refusal', () => {
    const words = ['expired', 'cancelled', 'provider', 'no-verified-email', 'disabled', 'server', 'not-invited'].map((error) =>
      reason(frag({ error, nonce: pending.nonce, p: 'github' })))
    expect(new Set(words).size).toBe(words.length)
    expect(reason(frag({ error: 'something-new', nonce: pending.nonce }))).toBe('The sign-in was refused — try again.')
  })

  it('an expired flow arrives without a nonce and is still shown (the pending sign-in is the check)', () => {
    expect(reason(frag({ error: 'expired' }))).toContain('took too long')
  })

  // Review finding: a link with no nonce could put any code, and the addresses it carries, on the sign-in screen.
  it('a refusal without a nonce is shown only when it is "expired"', () => {
    expect(checkReturn(frag({ error: 'not-invited', p: 'google', unvouched: 'whatever text a link carries' }), pending, pending.at + 1)).toBeNull()
    expect(checkReturn(frag({ error: 'disabled' }), pending, pending.at + 1)).toBeNull()
  })

  // Negative controls: a link nobody asked for must not put words on the sign-in screen.
  it('is ignored when no sign-in was started from this app', () => {
    expect(checkReturn(frag({ error: 'not-invited', p: 'github', emails: 'a@example.com' }), null, pending.at)).toBeNull()
  })

  it('is refused when its nonce is not the one this app issued', () => {
    expect(reason(frag({ error: 'disabled', nonce: 'attacker-chosen-value' }))).toContain('nonce mismatch')
  })

  it('a refusal after the 10-minute window says the sign-in took too long, not what the link claims', () => {
    expect(reason(frag({ error: 'disabled', nonce: pending.nonce }), pending, pending.at + 10 * 60_000 + 1)).toContain('took over 10 minutes')
  })

  it('a token wins over an error in the same fragment (a refusal never signs anyone in, a token needs its nonce)', () => {
    expect(checkReturn(frag({ token: 'abc', error: 'disabled', nonce: pending.nonce }), pending, pending.at + 1)).toMatchObject({ ok: true, token: 'abc' })
  })

  // What the Worker passes on is shown as text. It is bounded here too, because the fragment is whatever the link says.
  // (That the text is escaped when it is shown is the sign-in screen's `{{ }}`; here it is only passed through unchanged.)
  it('shows at most three addresses, none over 120 characters', () => {
    const long = `${'x'.repeat(130)}@example.com`
    // `long` comes FIRST: it would survive the three-entry cut, so only the length filter can keep it out.
    const text = reason(frag({ error: 'not-invited', nonce: pending.nonce, p: 'github', emails: `${long},a@example.com,<img src=x onerror=alert(1)>,c@example.com,d@example.com` }))
    expect(text).toContain('a@example.com, <img src=x onerror=alert(1)>, c@example.com')
    expect(text).not.toContain('d@example.com')
    expect(text).not.toContain('xxxxxxxxxx')
  })

  it('a provider name outside the list falls back to the one this app started with', () => {
    expect(reason(frag({ error: 'provider', nonce: pending.nonce, p: 'evil' }))).toContain('GitHub')
  })
})
