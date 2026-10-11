// Account data rights, the app half (H1-ENTRIES S2b; api/src/account.ts): export everything the server holds for the
// signed-in person, delete the account, and wipe the account's tables on this device.
import { db } from '@/db'
import { recordTables } from '@/db/records'
import { RECORD_KINDS, RECORD_TABLE } from '@/domain/records'
import { clearDraft, flushDrafts, hasDraft, isBlank, loadDraft } from '@/capture/draft'
import { clearPending } from '@/harness/pending'
import { syncEngine } from '@/sync'
import { API_URL, revokeSession, signOutLocally, storedToken, storeToken } from './signIn'

export type AccountExport = {
  format: number
  exportedAt: number
  account: unknown
  identities: unknown[]
  entries: unknown[]
  revisions: unknown[]
  /** Harness and widget records (answers, links, reports…) and what their stale edits replaced. Empty from an older Worker. */
  records: unknown[]
  recordRevisions: unknown[]
}

type Page = AccountExport & { cursor: number; more: boolean }
type Fetch = typeof fetch

export class AccountError extends Error {
  constructor(message: string, readonly status: number | null, readonly reason?: string) {
    super(message)
  }
}

async function failure(res: Response): Promise<AccountError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
  return new AccountError(body.error ?? `HTTP ${res.status}`, res.status, body.reason)
}

/**
 * The pages are not a snapshot: an entry edited on another device between two pages comes back on a later page at its new
 * version, with its revisions again. Keep the newest copy of each entry and one copy of each revision.
 */
function dedupe(out: AccountExport): AccountExport {
  const newest = new Map<string, { serverVersion?: number }>()
  for (const e of out.entries as { id: string; serverVersion?: number }[]) {
    const seen = newest.get(e.id)
    if (!seen || (e.serverVersion ?? 0) >= (seen.serverVersion ?? 0)) newest.set(e.id, e)
  }
  const revisions = new Map<string, unknown>()
  for (const r of out.revisions as { id: string; replacedVersion: number }[]) revisions.set(`${r.id}@${r.replacedVersion}`, r)
  // The same for records, keyed by kind AND id (an entryState shares its entry's id).
  const newestRecord = new Map<string, { serverVersion?: number }>()
  for (const r of out.records as { recordKind: string; id: string; serverVersion?: number }[]) {
    const k = `${r.recordKind}/${r.id}`
    const seen = newestRecord.get(k)
    if (!seen || (r.serverVersion ?? 0) >= (seen.serverVersion ?? 0)) newestRecord.set(k, r)
  }
  const recordRevisions = new Map<string, unknown>()
  for (const r of out.recordRevisions as { recordKind: string; id: string; replacedVersion: number }[]) recordRevisions.set(`${r.recordKind}/${r.id}@${r.replacedVersion}`, r)
  return { ...out, entries: [...newest.values()], revisions: [...revisions.values()], records: [...newestRecord.values()], recordRevisions: [...recordRevisions.values()] }
}

/**
 * Follows `GET /me/export` page by page and joins the pages. Throws without returning anything if any page fails, so a
 * half-finished download is never presented as a complete export.
 */
export async function exportAccount(token: string, fetchImpl: Fetch = fetch, apiUrl = API_URL): Promise<AccountExport> {
  const out: AccountExport = { format: 0, exportedAt: 0, account: null, identities: [], entries: [], revisions: [], records: [], recordRevisions: [] }
  let since = 0
  for (let guard = 0; guard < 10_000; guard++) {
    const res = await fetchImpl(`${apiUrl}/me/export?since=${since}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw await failure(res)
    const page = (await res.json()) as Page
    if (since === 0) { out.format = page.format; out.account = page.account; out.identities = page.identities }
    out.exportedAt = page.exportedAt
    out.entries.push(...page.entries)
    out.revisions.push(...page.revisions)
    out.records.push(...(page.records ?? [])) // absent from an older Worker
    out.recordRevisions.push(...(page.recordRevisions ?? []))
    if (!page.more) return dedupe(out)
    if (page.cursor <= since) throw new AccountError('export did not advance', null) // a stuck cursor would loop for ever
    since = page.cursor
  }
  throw new AccountError('export did not finish', null)
}

/** `DELETE /me`. The server removes the account only when `confirm` is the account's email. */
export async function deleteAccountRemote(token: string, confirm: string, fetchImpl: Fetch = fetch, apiUrl = API_URL): Promise<void> {
  const res = await fetchImpl(`${apiUrl}/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm }),
  })
  if (!res.ok) throw await failure(res)
}

/** Harness and widget records on this device, all kinds: part of what a clear would remove. */
const recordCount = async (): Promise<number> => (await Promise.all(recordTables(db).map((t) => t.count()))).reduce((a, b) => a + b, 0)

/** The stored draft as the owner sees it: a blank one is nothing. One reading for the question and for the clear's re-check. */
const draftNow = (): string => (isBlank(loadDraft()) ? '' : loadDraft())

type Cleared = { kind: 'cleared' } | { kind: 'unsynced'; n: number; draft: boolean } | { kind: 'changed' }

/**
 * The one place this device's account tables are emptied (D-50, D-55). It leaves the legacy financial tables, which belong
 * to the device. The checks and the clear are one transaction, so a capture that lands in between is counted, not cleared.
 *  - `refuseIfUnsynced`: stop while the outbox holds rows, or the capture box holds an unsent draft — both exist only on
 *    this device (sign-out, D-28, D-56).
 *  - `expect`: stop when the device no longer holds what the owner was shown (notes, unsent changes, the draft).
 *  - `dropToken`: the token goes FIRST, inside the transaction and after the checks (so a refused sign-out never flickers
 *    the engine into "signed out"). Otherwise a poll tick between the engine reset and the end of the clear starts a cycle
 *    that claims the cleared device for the account being left. It comes back if the clear fails — in the callback or at
 *    commit, which is why the restore wraps the whole transaction.
 *
 * Not exported on purpose: every caller is a gesture of the owner (sign out, Clear this device, delete account), each with
 * its own guards above. Never reach it from a server verdict (401, account deleted) — D-55.
 */
async function clearAccountData(o: { refuseIfUnsynced?: boolean; expect?: { entries: number; records: number; outbox: number; draft: string }; dropToken?: boolean } = {}): Promise<Cleared> {
  const token = o.dropToken ? storedToken() : null
  try {
    const r = await db.transaction('rw', [db.entries, db.outbox, db.syncMeta, ...recordTables(db)], async (): Promise<Cleared> => {
      const outbox = await db.outbox.count()
      flushDrafts() // text typed since the question is stored before it is compared, not wiped unseen
      const draft = hasDraft()
      if (o.refuseIfUnsynced && (outbox > 0 || draft)) return { kind: 'unsynced', n: outbox, draft }
      if (o.expect && (outbox !== o.expect.outbox || (await db.entries.count()) !== o.expect.entries || (await recordCount()) !== o.expect.records || draftNow() !== o.expect.draft)) return { kind: 'changed' }
      if (o.dropToken) signOutLocally()
      syncEngine.reset() // a cycle in flight must not write this account's rows back after the clear
      await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), ...recordTables(db).map((t) => t.clear())])
      return { kind: 'cleared' }
    })
    // The unsent draft is the owner's text too (D-56): it goes with the rest, and an open capture box is told.
    if (r.kind === 'cleared') {
      clearDraft()
      clearPending() // a waiting run names this account's notes
    }
    return r
  } catch (err) {
    if (token && storedToken() === null) storeToken(token)
    throw err
  }
}

/** Entries on this device the server has not acknowledged: what a wipe would lose. */
export const unsyncedCount = (): Promise<number> => db.outbox.count()

/**
 * Sign out (D-28): refused while notes have not reached the server — or an unsent draft sits in the capture box (D-56) —
 * they exist only on this device, and clearing the account's tables is part of signing out (D-50). The count (and the
 * `draft` flag) says what stands in the way. Afterwards the server is told to
 * end the session (best effort, D-55): without that, a token copied off the device stays good for 30 more days.
 */
export async function signOutSafely(fetchImpl: Fetch = fetch, apiUrl = API_URL): Promise<{ ok: true } | { ok: false; unsynced: number; draft?: true }> {
  const token = storedToken()
  flushDrafts() // what is stored is what the owner sees in the box
  const r = await clearAccountData({ refuseIfUnsynced: true, dropToken: true })
  if (r.kind === 'unsynced') return { ok: false, unsynced: r.n, ...(r.draft ? { draft: true as const } : {}) }
  if (token) void revokeSession(token, fetchImpl, apiUrl)
  return { ok: true }
}

/** Everything this device holds for the account, as a plain object: the copy offered before a device is cleared (D-50). */
export type LocalCopy = { exportedAt: string; entries: unknown[]; /** Every harness / widget record by table: the owner's answers are theirs and may exist only here. */ records: Record<string, unknown[]>; notSynced: unknown[]; draft: string }
export async function localCopy(): Promise<LocalCopy> {
  const records: Record<string, unknown[]> = {}
  for (const kind of RECORD_KINDS) records[RECORD_TABLE[kind]] = await db.table(RECORD_TABLE[kind]).toArray()
  return { exportedAt: new Date().toISOString(), entries: await db.entries.toArray(), records, notSynced: await db.outbox.toArray(), draft: loadDraft() }
}

export type DeviceClearDeps = { confirm: (message: string) => boolean; saveCopy: (copy: LocalCopy) => void }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * "Clear this device" (the sync banner, D-55). The notes on a device whose account is gone — or that belongs to another
 * account — may be the only copy left, so the question names every note on it (not just the unsent ones), a copy is saved
 * before anything is cleared (a copy that cannot be saved clears nothing), and the clear itself re-checks that the device
 * still holds what the owner was shown.
 */
export async function clearDeviceSafely(deps: DeviceClearDeps, opts: { dropToken?: boolean } = {}): Promise<'cleared' | 'declined' | 'changed'> {
  flushDrafts() // what is stored is what the owner sees in the box
  const entries = await db.entries.count()
  const records = await recordCount()
  const outbox = await db.outbox.count()
  const draftText = draftNow()
  const draft = draftText !== ''
  if (entries > 0 || records > 0 || outbox > 0 || draft) {
    const only = outbox > 0 ? ` (${outbox} not uploaded yet — they exist only here)` : ''
    const what = [entries > 0 ? plural(entries, 'note') : '', records > 0 ? plural(records, 'saved item') : '', draft ? 'an unsent draft' : ''].filter(Boolean).join(' and ')
    if (!deps.confirm(`${what} on this device will be cleared${only}. A copy is downloaded first. Clear it?`)) return 'declined'
    deps.saveCopy(await localCopy())
  }
  const r = await clearAccountData({ expect: { entries, records, outbox, draft: draftText }, dropToken: opts.dropToken })
  return r.kind === 'cleared' ? 'cleared' : 'changed'
}

/** Export (done by the caller first), delete on the server, then this device: tables and token. */
export async function deleteMyAccount(confirm: string, fetchImpl: Fetch = fetch, apiUrl = API_URL): Promise<void> {
  const token = storedToken()
  if (!token) throw new AccountError('not signed in', 401)
  try {
    await deleteAccountRemote(token, confirm, fetchImpl, apiUrl)
  } catch (err) {
    // The server committed the delete but its answer never arrived (or the wipe below failed on a first try): the retry
    // then meets "account deleted", which means the server half is done — carry on to this device's half.
    if (!(err instanceof AccountError && err.status === 401 && err.reason === 'account-deleted')) throw err
  }
  await clearAccountData({ dropToken: true }) // if this throws the token stays, so the same button can run it again
}
