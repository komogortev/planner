// Account data rights, the app half (H1-ENTRIES S2b; api/src/account.ts): export everything the server holds for the
// signed-in person, delete the account, and wipe the account's tables on this device.
import { db } from '@/db'
import { syncEngine } from '@/sync'
import { API_URL, signOutLocally, storedToken } from './signIn'

export type AccountExport = {
  format: number
  exportedAt: number
  account: unknown
  identities: unknown[]
  entries: unknown[]
  revisions: unknown[]
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
  return { ...out, entries: [...newest.values()], revisions: [...revisions.values()] }
}

/**
 * Follows `GET /me/export` page by page and joins the pages. Throws without returning anything if any page fails, so a
 * half-finished download is never presented as a complete export.
 */
export async function exportAccount(token: string, fetchImpl: Fetch = fetch, apiUrl = API_URL): Promise<AccountExport> {
  const out: AccountExport = { format: 0, exportedAt: 0, account: null, identities: [], entries: [], revisions: [] }
  let since = 0
  for (let guard = 0; guard < 10_000; guard++) {
    const res = await fetchImpl(`${apiUrl}/me/export?since=${since}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw await failure(res)
    const page = (await res.json()) as Page
    if (since === 0) { out.format = page.format; out.account = page.account; out.identities = page.identities }
    out.exportedAt = page.exportedAt
    out.entries.push(...page.entries)
    out.revisions.push(...page.revisions)
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

/**
 * Empties the tables that belong to the account (D-50) and leaves the legacy financial tables, which belong to the
 * device. Entries still in the outbox are lost with it — callers say so first.
 */
export async function wipeAccountTables(): Promise<void> {
  syncEngine.reset() // a cycle in flight must not write this account rows back after the wipe
  await db.transaction('rw', db.entries, db.outbox, db.syncMeta, async () => {
    await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear()])
  })
}

/** Entries on this device the server has not acknowledged: what a wipe would lose. */
export const unsyncedCount = (): Promise<number> => db.outbox.count()

/**
 * Sign out (D-28): refused while notes have not reached the server — they exist only on this device, and clearing the
 * account's tables is part of signing out (D-50). The count says what stands in the way.
 */
export async function signOutSafely(): Promise<{ ok: true } | { ok: false; unsynced: number }> {
  // The count and the clear are one transaction: a capture that lands between them is counted, not cleared. The engine is
  // reset inside it, so no cycle that started earlier can write after the clear.
  const unsynced = await db.transaction('rw', db.entries, db.outbox, db.syncMeta, async () => {
    const n = await db.outbox.count()
    if (n > 0) return n
    syncEngine.reset()
    await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear()])
    return 0
  })
  if (unsynced > 0) return { ok: false, unsynced }
  signOutLocally()
  return { ok: true }
}

/** Everything this device holds for the account, as a plain object: the copy offered before a device is cleared (D-50). */
export async function localCopy(): Promise<{ exportedAt: string; entries: unknown[]; notSynced: unknown[] }> {
  return { exportedAt: new Date().toISOString(), entries: await db.entries.toArray(), notSynced: await db.outbox.toArray() }
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
  await wipeAccountTables() // if this throws the token stays, so the same button can run it again
  signOutLocally()
}
