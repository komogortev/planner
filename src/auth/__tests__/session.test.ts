// D-55 (amends D-50): the only things that delete this device's notes are the owner's own gestures — sign out, "Clear this
// device", delete account. These tests pin the order and the guards of those gestures. Each guard has a negative control.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDeviceSafely, deleteMyAccount, signOutSafely } from '../account'
import { db } from '@/db'
import { captureEntry } from '@/capture/capture'
import { syncEngine } from '@/sync'
import { CLEARED_KEY, DRAFT_CLEARED, DRAFT_FLUSH, DRAFT_KEY, loadDraft, saveDraft } from '@/capture/draft'

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
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear()])
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

  it('saves a copy of every note BEFORE it clears, then clears the account tables', async () => {
    await seedSynced(2)
    await db.syncMeta.put({ userId: 'u1', cursor: 2, lastPushAt: null, lastPullAt: null })
    // The copy holds both notes only if it was taken before the clear (a copy taken after would hold none).
    let copied = -1
    const out = await clearDeviceSafely({ confirm: () => true, saveCopy: (c) => { copied = c.entries.length } })
    expect(out).toBe('cleared')
    expect(copied).toBe(2)
    expect(await db.entries.count()).toBe(0)
    expect(await db.syncMeta.count()).toBe(0)
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

// D-56: an unsent draft is the owner's text that exists nowhere else. Sign-out refuses for it like for an unsent note, "Clear
// this device" names it and keeps it in the copy, delete-account clears it; a refused or failed gesture keeps it.
describe('the unsent draft and the wipe gestures (D-56)', () => {
  beforeEach(() => { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(CLEARED_KEY) })

  // M5: only a completed clear may take the draft.
  it('"Clear this device" takes the draft with the rest, tells the open box, and the copy holds it', async () => {
    await seedSynced(1)
    saveDraft('half a thought')
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    try {
      let heard = 0
      target.addEventListener(DRAFT_CLEARED, () => heard++)
      let copied: { draft: string } | null = null
      expect(await clearDeviceSafely({ confirm: () => true, saveCopy: (c) => { copied = c } })).toBe('cleared')
      expect(copied).toMatchObject({ draft: 'half a thought' })
      expect(loadDraft()).toBe('')
      expect(heard).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('"Clear this device" asks even when only a draft is on the device', async () => {
    saveDraft('only a draft')
    const asked: string[] = []
    expect(await clearDeviceSafely({ confirm: (m) => (asked.push(m), true), saveCopy: () => undefined })).toBe('cleared')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('an unsent draft')
    expect(asked[0]).not.toContain('0 notes')
  })

  it('a draft of only whitespace is nothing: no question, and nothing to count', async () => {
    localStorage.setItem(DRAFT_KEY, ' \n ')
    const asked: string[] = []
    expect(await clearDeviceSafely({ confirm: (m) => (asked.push(m), true), saveCopy: () => undefined })).toBe('cleared')
    expect(asked).toHaveLength(0)
  })

  it('declining keeps the draft', async () => {
    saveDraft('only a draft')
    expect(await clearDeviceSafely({ confirm: () => false, saveCopy: () => undefined })).toBe('declined')
    expect(loadDraft()).toBe('only a draft')
  })

  it('a clear that fails keeps the draft', async () => {
    await seedSynced(1)
    saveDraft('half a thought')
    vi.spyOn(db.syncMeta, 'clear').mockRejectedValue(new Error('disk full'))
    await expect(clearDeviceSafely(yes)).rejects.toThrow('disk full')
    expect(loadDraft()).toBe('half a thought')
  })

  // Review finding: a "changed" outcome used to be able to take the draft.
  it('a clear that stops because the device changed keeps the draft', async () => {
    await seedSynced(1)
    saveDraft('half a thought')
    let late: Promise<unknown> = Promise.resolve()
    expect(await clearDeviceSafely({ confirm: () => true, saveCopy: () => { late = captureEntry('arrived late') } })).toBe('changed')
    await late
    expect(loadDraft()).toBe('half a thought')
  })

  it('stops when the draft itself changed after the question', async () => {
    saveDraft('what the owner was shown')
    expect(await clearDeviceSafely({ confirm: () => true, saveCopy: () => saveDraft('typed after the question') })).toBe('changed')
    expect(loadDraft()).toBe('typed after the question')
  })

  it('sign-out is refused for an unsent draft, like for an unsent note, and keeps it', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    saveDraft('half a thought')
    let called = false
    const spy: typeof fetch = async () => { called = true; return new Response(null, { status: 204 }) }
    expect(await signOutSafely(spy, API)).toEqual({ ok: false, unsynced: 0, draft: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(called).toBe(false)
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
    expect(loadDraft()).toBe('half a thought')
    expect(await db.entries.count()).toBe(1)
  })

  it('sign-out names both when both stand in the way', async () => {
    expect((await captureEntry('not uploaded')).ok).toBe(true)
    saveDraft('half a thought')
    expect(await signOutSafely(ok204, API)).toEqual({ ok: false, unsynced: 1, draft: true })
  })

  it('sign-out goes ahead with a blank box, and clears the stored draft marker state', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    localStorage.setItem(DRAFT_KEY, ' \n ')
    expect(await signOutSafely(ok204, API)).toEqual({ ok: true })
    expect(loadDraft()).toBe('')
  })

  it('delete-account takes the draft with the rest', async () => {
    saveDraft('half a thought')
    localStorage.setItem(TOKEN_KEY, 'tok')
    await deleteMyAccount('me@example.com', async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }), API)
    expect(loadDraft()).toBe('')
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('asks the open box to write what it holds before it reads the stored draft', async () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    try {
      // the box types "typed just now" but has not saved it yet; a flush request makes it save
      target.addEventListener(DRAFT_FLUSH, () => saveDraft('typed just now'))
      const asked: string[] = []
      await clearDeviceSafely({ confirm: (m) => (asked.push(m), false), saveCopy: () => undefined })
      expect(asked[0]).toContain('an unsent draft')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('sign-out and the open capture box (D-56)', () => {
  // The guard reads the STORED draft; what the owner sees is the box. Without the flush request the box's last 250 ms of
  // typing is not stored yet and sign-out goes ahead over it.
  it('asks the open box to write what it holds before it decides', async () => {
    await seedSynced(1)
    localStorage.setItem(TOKEN_KEY, 'tok')
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    try {
      target.addEventListener(DRAFT_FLUSH, () => saveDraft('typed just now'))
      expect(await signOutSafely(ok204, API)).toEqual({ ok: false, unsynced: 0, draft: true })
      expect(localStorage.getItem(TOKEN_KEY)).toBe('tok')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // Typed after the question, while the copy was being made: the clear's own flush stores it, and the re-check stops.
  it('"Clear this device" stops for text typed after the question, even before the box has saved it', async () => {
    await seedSynced(1)
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    try {
      let typed = false
      target.addEventListener(DRAFT_FLUSH, () => { if (typed) saveDraft('typed during the copy') })
      const out = await clearDeviceSafely({ confirm: () => true, saveCopy: () => { typed = true } })
      expect(out).toBe('changed')
      expect(loadDraft()).toBe('typed during the copy')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
