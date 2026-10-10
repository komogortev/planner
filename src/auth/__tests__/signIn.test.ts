import { describe, expect, it } from 'vitest'
import { checkReturn } from '../signIn'

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
