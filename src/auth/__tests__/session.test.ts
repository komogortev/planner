// D-55 (amends D-50): the only things that delete this device's notes are the owner's own gestures — sign out, "Clear this
// device", delete account. These tests pin the order and the guards of those gestures. Each guard has a negative control.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDeviceSafely, signOutSafely } from '../account'
import { db } from '@/db'
import { captureEntry } from '@/capture/capture'
import { syncEngine } from '@/sync'

const API = 'https://api.test'
const TOKEN_KEY = 'planner.signIn.token'

// The suite runs in node: a minimal localStorage, enough for the token key signIn.ts reads and removes.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
})

const ok204: typeof fetch = async () => new Response(null, { status: 204 })
const yes = { confirm: () => true, saveCopy: () => undefined }

beforeEach(async () => {
  localStorage.clear()
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), db.commitments.clear()])
})
afterEach(() => vi.restoreAllMocks())

/** Notes the server has acknowledged: after the account is gone they are the only copy there is. */
async function seedSynced(n: number): Promise<void> {
  for (let i = 0; i < n; i++) expect((await captureEntry(`note ${i}`)).ok).toBe(true)
  await db.outbox.clear()
}

describe('signOutSafely: the token goes first, the server hears about it', () => {
  // Review finding: the token used to be removed after the clear, so a poll tick in between started a cycle that claimed
  // the cleared device for the account being left. Known positive: this fails on the old order.
  it('drops the token before it resets the engine, so no new cycle can start in between', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    let tokenAtReset: string | null = 'reset was not called'
    vi.spyOn(syncEngine, 'reset').mockImplementation(() => { tokenAtReset = localStorage.getItem(TOKEN_KEY) })
    expect(await signOutSafely(ok204, API)).toEqual({ ok: true })
    expect(tokenAtReset).toBeNull()
  })

  it('asks the server to end the session, with the token, once the device is cleared', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    const calls: { url: string; method?: string; auth: string | null; entriesLeft: number; tokenLeft: string | null }[] = []
    const fake: typeof fetch = async (input, init) => {
      // What the device looked like at the moment the server was asked: already cleared (the order matters — see below).
      calls.push({
        url: String(input), method: init?.method, auth: new Headers(init?.headers).get('Authorization'),
        entriesLeft: await db.entries.count(), tokenLeft: localStorage.getItem(TOKEN_KEY),
      })
      return new Response(null, { status: 204 })
    }
    expect(await signOutSafely(fake, API)).toEqual({ ok: true })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: `${API}/auth/logout`, method: 'POST', auth: 'Bearer tok', entriesLeft: 0, tokenLeft: null })
  })

  // Negative control: a refused sign-out ends nothing on the server and keeps the token.
  it('does not call the server, and keeps the token, when the sign-out is refused', async () => {
    expect((await captureEntry('not uploaded')).ok).toBe(true)
    localStorage.setItem(TOKEN_KEY, 'tok')
    let called = false
    const spy: typeof fetch = async () => { called = true; return new Response(null, { status: 204 }) }
    expect(await signOutSafely(spy, API)).toEqual({ ok: false, unsynced: 1 })
    await new Promise((r) => setTimeout(r, 20))
    expect(called).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
  })

  it('still signs out when the server cannot be reached', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    const down: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
    expect(await signOutSafely(down, API)).toEqual({ ok: true })
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(await db.entries.count()).toBe(0)
  })

  // Review finding: the earlier version mocked `entries.clear`, so "nothing was cleared" held with no transaction at all.
  // Here the REAL entries.clear and outbox.clear run, and the LAST clear fails: only a rollback leaves the counts as they were.
  it('a clear that fails rolls every table back and puts the token back', async () => {
    await seedSynced(1)
    expect((await captureEntry('only here')).ok).toBe(true) // outbox: 1
    await db.syncMeta.put({ userId: 'u1', cursor: 1, lastPushAt: null, lastPullAt: null })
    localStorage.setItem(TOKEN_KEY, 'tok')
    vi.spyOn(db.syncMeta, 'clear').mockRejectedValue(new Error('disk full'))
    await expect(clearDeviceSafely(yes, { dropToken: true })).rejects.toThrow('disk full')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
    expect([await db.entries.count(), await db.outbox.count(), await db.syncMeta.count()]).toEqual([2, 1, 1])
  })
})

describe('clearDeviceSafely', () => {
  it('an empty device is cleared without a question or a copy', async () => {
    const asked: string[] = []
    const saved: unknown[] = []
    const out = await clearDeviceSafely({ confirm: (m) => (asked.push(m), true), saveCopy: (c) => void saved.push(c) })
    expect(out).toBe('cleared')
    expect(asked).toHaveLength(0)
    expect(saved).toHaveLength(0)
  })

  // Review finding: with an empty outbox the old banner wiped synced notes — the only copy — without asking.
  it('synced notes are named in the question even when the outbox is empty', async () => {
    await seedSynced(3)
    const asked: string[] = []
    await clearDeviceSafely({ confirm: (m) => (asked.push(m), false), saveCopy: () => undefined })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('3 notes')
    expect(asked[0]).not.toContain('not uploaded')
  })

  it('names the notes that exist only here', async () => {
    await seedSynced(1)
    expect((await captureEntry('only here')).ok).toBe(true)
    const asked: string[] = []
    await clearDeviceSafely({ confirm: (m) => (asked.push(m), false), saveCopy: () => undefined })
    expect(asked[0]).toContain('2 notes')
    expect(asked[0]).toContain('1 not uploaded')
  })

  it('declined: nothing is saved and nothing is cleared', async () => {
    await seedSynced(2)
    const saved: unknown[] = []
    expect(await clearDeviceSafely({ confirm: () => false, saveCopy: (c) => void saved.push(c) })).toBe('declined')
    expect(saved).toHaveLength(0)
    expect(await db.entries.count()).toBe(2)
  })

  it('saves a copy of every note BEFORE it clears, then clears the account tables and keeps the legacy ones', async () => {
    await seedSynced(2)
    await db.syncMeta.put({ userId: 'u1', cursor: 2, lastPushAt: null, lastPullAt: null })
    await db.commitments.put({
      id: 'c1', type: 'other', label: 'legacy', startDate: '2026-01-01', principal: 1, annualRate: 0, termMonths: 1, paymentDay: 1,
      notes: '', categoryId: null, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })
    // The copy holds both notes only if it was taken before the clear (a copy taken after would hold none).
    let copied = -1
    const out = await clearDeviceSafely({ confirm: () => true, saveCopy: (c) => { copied = c.entries.length } })
    expect(out).toBe('cleared')
    expect(copied).toBe(2)
    expect(await db.entries.count()).toBe(0)
    expect(await db.syncMeta.count()).toBe(0)
    expect(await db.commitments.count()).toBe(1)
  })

  // Negative control for the order: if the copy cannot be made, the notes stay.
  it('a copy that fails to save clears nothing', async () => {
    await seedSynced(2)
    const boom = { confirm: () => true, saveCopy: () => { throw new Error('download blocked') } }
    await expect(clearDeviceSafely(boom)).rejects.toThrow('download blocked')
    expect(await db.entries.count()).toBe(2)
  })

  // A note captured between what the owner was shown and the clear is counted, not cleared.
  it('stops when the device changed after the question', async () => {
    await seedSynced(1)
    let late: Promise<unknown> = Promise.resolve()
    const out = await clearDeviceSafely({ confirm: () => true, saveCopy: () => { late = captureEntry('arrived late') } })
    await late
    expect(out).toBe('changed')
    expect(await db.entries.count()).toBe(2)
    expect(await db.outbox.count()).toBe(1)
  })

  it('the token goes with the notes only when asked', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    await clearDeviceSafely(yes)
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
    await seedSynced(1)
    await clearDeviceSafely(yes, { dropToken: true })
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
