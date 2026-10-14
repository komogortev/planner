// D-22 client: the Worker calls and the wording. A fake fetch stands in for /me/sessions (the Worker side is tested in
// api/test/sessions.test.ts).
import { describe, expect, it } from 'vitest'
import { deviceName, listSessions, seenLabel, SessionsError, signOutOthers, signOutSession } from '../sessions'

type Seen = { url: string; method: string; auth: string | null }
function fake(status: number, body: unknown, seen: Seen[] = []) {
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? 'GET', auth: (init.headers as Record<string, string>).Authorization ?? null })
    return new Response(status === 204 ? null : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { fetchImpl, apiUrl: 'https://api.test', token: 'tok' }
}

describe('the Worker calls', () => {
  it('list, sign out one, sign out others: the right route, method and bearer', async () => {
    const seen: Seen[] = []
    const list = [{ id: 'abcdefghijklmnop', device: 'Chrome on Android', createdAt: 1, lastSeenAt: 2, current: true }]
    expect(await listSessions(fake(200, { sessions: list }, seen))).toEqual(list)
    await signOutSession('abcdefghijklmnop', fake(204, null, seen))
    expect(await signOutOthers(fake(200, { signedOut: 2 }, seen))).toBe(2)
    expect(seen).toEqual([
      { url: 'https://api.test/me/sessions', method: 'GET', auth: 'Bearer tok' },
      { url: 'https://api.test/me/sessions/abcdefghijklmnop', method: 'DELETE', auth: 'Bearer tok' },
      { url: 'https://api.test/me/sessions/others', method: 'POST', auth: 'Bearer tok' },
    ])
  })

  it('says what went wrong: signed out, already gone, the Worker’s own reason, no connection, no token', async () => {
    const msg = (p: Promise<unknown>) => p.then(() => 'resolved', (e: SessionsError) => e.message)
    expect(await msg(listSessions(fake(401, {})))).toBe('Signed out. Sign in again.')
    expect(await msg(signOutSession('x', fake(404, { error: 'not found' })))).toBe('That device is already signed out.')
    expect(await msg(signOutSession('x', fake(409, { error: 'this device: use Sign out' })))).toBe('this device: use Sign out')
    const offline = { fetchImpl: (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch, apiUrl: 'https://api.test', token: 'tok' }
    expect(await msg(listSessions(offline))).toBe('No connection to the server.')
    expect(await msg(listSessions({ token: null }))).toBe('Sign in first.')
  })
})

describe('wording', () => {
  const NOW = Date.UTC(2026, 9, 13, 12)
  it.each([
    [NOW - 3_600_000, 'today'],
    [NOW - 86_400_000, 'yesterday'],
    [NOW - 3 * 86_400_000, '3 days ago'],
    [NOW - 10 * 86_400_000, '2026-10-03'],
  ])('seen %s → %s', (at, label) => expect(seenLabel(at, NOW)).toBe(label))
  it('a session from before device labels is named plainly', () => {
    expect(deviceName({ device: null })).toBe('Unknown device')
    expect(deviceName({ device: 'Edge on Windows' })).toBe('Edge on Windows')
  })
})
