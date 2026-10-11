import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AccountError, deleteAccountRemote, deleteMyAccount, exportAccount, signOutSafely, unsyncedCount, wipeAccountTables } from '../account'
import { db } from '@/db'
import { captureEntry } from '@/capture/capture'

const API = 'https://api.test'

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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function page(over: Record<string, unknown>) {
  return { format: 1, exportedAt: 1, entries: [], revisions: [], cursor: 0, more: false, ...over }
}

beforeEach(async () => {
  localStorage.clear()
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), db.commitments.clear()])
})

describe('exportAccount', () => {
  it('follows the cursor, sends the token, keeps the account from the first page and joins the rest', async () => {
    const calls: { url: string; auth: string | null }[] = []
    const pages = [
      page({ account: { id: 'u1' }, identities: [{ provider: 'github' }], entries: [{ id: 'a' }, { id: 'b' }], revisions: [{ id: 'a' }], cursor: 2, more: true }),
      page({ entries: [{ id: 'c' }], cursor: 3, more: false }),
    ]
    const fake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') })
      return json(pages[calls.length - 1])
    }
    const out = await exportAccount('tok', fake, API)
    expect(calls.map((c) => c.url)).toEqual([`${API}/me/export?since=0`, `${API}/me/export?since=2`])
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true)
    expect(out.account).toEqual({ id: 'u1' })
    expect(out.identities).toEqual([{ provider: 'github' }])
    expect(out.entries).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(out.revisions).toEqual([{ id: 'a' }])
  })

  // Review finding: an entry edited between two pages comes back on the later page; the file must hold it once, newest.
  it('keeps one copy of an entry and of a revision that two pages both carried', async () => {
    const pages = [
      page({ account: { id: 'u1' }, entries: [{ id: 'x', serverVersion: 5, body: 'old' }, { id: 'y', serverVersion: 6 }],
        revisions: [{ id: 'x', replacedVersion: 3 }], cursor: 6, more: true }),
      page({ entries: [{ id: 'x', serverVersion: 9, body: 'new' }], revisions: [{ id: 'x', replacedVersion: 3 }, { id: 'x', replacedVersion: 5 }], cursor: 9, more: false }),
    ]
    let n = 0
    const out = await exportAccount('tok', async () => json(pages[n++]), API)
    expect(out.entries).toHaveLength(2)
    expect((out.entries as { id: string; body?: string }[]).find((e) => e.id === 'x')?.body).toBe('new')
    expect(out.revisions).toHaveLength(2)
  })

  // Negative controls: no partial file may look like a whole export.
  it('throws, returning nothing, when a later page fails', async () => {
    let n = 0
    const fake: typeof fetch = async () => (++n === 1 ? json(page({ entries: [{ id: 'a' }], cursor: 1, more: true })) : json({ error: 'boom' }, 500))
    await expect(exportAccount('tok', fake, API)).rejects.toMatchObject({ status: 500, message: 'boom' })
  })

  it('throws when the cursor does not advance instead of looping', async () => {
    const fake: typeof fetch = async () => json(page({ cursor: 0, more: true }))
    await expect(exportAccount('tok', fake, API)).rejects.toThrow('did not advance')
  })

  it('surfaces the account-deleted reason from a 401', async () => {
    const fake: typeof fetch = async () => json({ error: 'signed out', reason: 'account-deleted' }, 401)
    await expect(exportAccount('tok', fake, API)).rejects.toMatchObject({ status: 401, reason: 'account-deleted' })
  })
})

describe('deleteAccountRemote', () => {
  it('sends DELETE /me with the token and the confirmation', async () => {
    let seen: { url: string; method?: string; auth: string | null; body: unknown } | null = null
    const fake: typeof fetch = async (input, init) => {
      seen = { url: String(input), method: init?.method, auth: new Headers(init?.headers).get('Authorization'), body: JSON.parse(String(init?.body)) }
      return json({ deleted: true })
    }
    await deleteAccountRemote('tok', 'me@example.com', fake, API)
    expect(seen).toEqual({ url: `${API}/me`, method: 'DELETE', auth: 'Bearer tok', body: { confirm: 'me@example.com' } })
  })

  it('throws on a refusal', async () => {
    const fake: typeof fetch = async () => json({ error: 'confirm: must be the email of the account' }, 400)
    await expect(deleteAccountRemote('tok', 'x', fake, API)).rejects.toBeInstanceOf(AccountError)
  })
})

describe('wiping this device (D-50)', () => {
  async function seed() {
    expect((await captureEntry('hello')).ok).toBe(true)
    await db.syncMeta.put({ userId: 'u1', cursor: 3, lastPushAt: null, lastPullAt: null })
    await db.commitments.put({
      id: 'c1', type: 'other', label: 'legacy', startDate: '2026-01-01', principal: 1, annualRate: 0, termMonths: 1, paymentDay: 1,
      notes: '', categoryId: null, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })
  }

  it('empties entries, outbox and sync state, and leaves the legacy financial tables', async () => {
    await seed()
    expect(await db.entries.count()).toBe(1) // exercised: there is something to wipe
    expect(await unsyncedCount()).toBe(1)
    await wipeAccountTables()
    expect(await db.entries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.syncMeta.count()).toBe(0)
    expect(await db.commitments.count()).toBe(1)
  })

  it('deleteMyAccount: the server refusing leaves this device untouched', async () => {
    await seed()
    localStorage.setItem('planner.signIn.token', 'tok')
    const refuse: typeof fetch = async () => json({ error: 'confirm: must be the email of the account' }, 400)
    await expect(deleteMyAccount('wrong', refuse, API)).rejects.toBeInstanceOf(AccountError)
    expect(await db.entries.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
    expect(localStorage.getItem('planner.signIn.token')).toBe('tok')
  })

  it('deleteMyAccount: on success the account tables and the token go, the legacy tables stay', async () => {
    await seed()
    localStorage.setItem('planner.signIn.token', 'tok')
    const ok: typeof fetch = async () => json({ deleted: true })
    await deleteMyAccount('me@example.com', ok, API)
    expect(await db.entries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(localStorage.getItem('planner.signIn.token')).toBeNull()
    expect(await db.commitments.count()).toBe(1)
  })

  // Review finding: the server committed, the answer was lost; the retry hears "account deleted" and must still wipe.
  it('deleteMyAccount: a retry that meets "account deleted" finishes this device', async () => {
    await seed()
    localStorage.setItem('planner.signIn.token', 'tok')
    const gone: typeof fetch = async () => json({ error: 'signed out', reason: 'account-deleted' }, 401)
    await deleteMyAccount('me@example.com', gone, API)
    expect(await db.entries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(localStorage.getItem('planner.signIn.token')).toBeNull()
    expect(await db.commitments.count()).toBe(1)
  })

  it('deleteMyAccount: a plain 401 (not deleted) is still an error and wipes nothing', async () => {
    await seed()
    localStorage.setItem('planner.signIn.token', 'tok')
    const plain: typeof fetch = async () => json({ error: 'signed out' }, 401)
    await expect(deleteMyAccount('me@example.com', plain, API)).rejects.toMatchObject({ status: 401 })
    expect(await db.entries.count()).toBe(1)
    expect(localStorage.getItem('planner.signIn.token')).toBe('tok')
  })

  it('deleteMyAccount: without a token it calls nothing and wipes nothing', async () => {
    await seed()
    let called = false
    const spy: typeof fetch = async () => { called = true; return json({}) }
    await expect(deleteMyAccount('x', spy, API)).rejects.toMatchObject({ status: 401 })
    expect(called).toBe(false)
    expect(await db.entries.count()).toBe(1)
  })
})

describe('signOutSafely (D-28)', () => {
  it('is refused while notes have not reached the server: nothing is cleared, the count is named', async () => {
    expect((await captureEntry('not uploaded yet')).ok).toBe(true)
    localStorage.setItem('planner.signIn.token', 'tok')
    expect(await signOutSafely()).toEqual({ ok: false, unsynced: 1 })
    expect(await db.entries.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
    expect(localStorage.getItem('planner.signIn.token')).toBe('tok')
  })

  // Negative control for the test above: with the outbox empty the same call does sign out and clear the account tables.
  it('with an empty outbox it clears the account tables and the token, and leaves the legacy tables', async () => {
    expect((await captureEntry('already uploaded')).ok).toBe(true)
    await db.outbox.clear() // as after a successful push
    await db.commitments.put({
      id: 'c1', type: 'other', label: 'legacy', startDate: '2026-01-01', principal: 1, annualRate: 0, termMonths: 1, paymentDay: 1,
      notes: '', categoryId: null, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })
    localStorage.setItem('planner.signIn.token', 'tok')
    expect(await signOutSafely()).toEqual({ ok: true })
    expect(await db.entries.count()).toBe(0)
    expect(localStorage.getItem('planner.signIn.token')).toBeNull()
    expect(await db.commitments.count()).toBe(1)
  })
})
