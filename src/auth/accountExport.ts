// The account export's page join (H1-ENTRIES S2b), kept free of imports so the Worker test can run the same code against a
// real D1 (api/test/exportLocal.test.ts): api/scripts/export-local.mjs must produce exactly what this produces.

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

export async function failure(res: Response): Promise<AccountError> {
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
export async function exportPages(token: string, fetchImpl: Fetch, apiUrl: string): Promise<AccountExport> {
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
