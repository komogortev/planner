// R6 — the nightly export (ARCHITECTURE §4, H1-ENTRIES §9, ALPHA-TEST-PLAN R6). A cron writes the owner's account to the
// private data repo as one commit: `export/entries/<YYYY-MM>.json` per month of `createdAt` (with that month's revisions),
// `export/records.json`, `export/account.json` and `export/meta.json`. The content is the account export (`exportPage`,
// format 1) with its per-page `exportedAt` left out, so a night with no change builds the same tree and makes no commit.
//
// Scope (D-122 Q1): ONE account, named by the EXPORT_ACCOUNT_EMAIL secret; every read is bound to its id. No other account's
// notes leave Cloudflare — test/nightlyExport.test.ts holds that with a second account present.
// Failures go to error_log (route `/cron/export`), never to the repo. Until both secrets are set every night logs
// `export.not-configured`: the row that shows the cron fires.
import { EXPORT_FORMAT, exportPage } from './account'
import { PULL_MAX } from './entries'
import { GITHUB_API, githubHeaders } from './integrations'
import { writeErrorLog } from './log'
import type { Env } from './index'

export const EXPORT_ROUTE = '/cron/export'
export const EXPORT_DIR = 'export'
const GITHUB_TIMEOUT_MS = 15_000
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

export type ExportOutcome =
  | { status: 'committed'; commit: string; files: number; entries: number }
  | { status: 'unchanged'; entries: number }
  | { status: 'failed'; reason: string }

/** A failure with a short, content-free reason for error_log (`export.<reason>`, ≤ 40 characters in all). */
class ExportError extends Error {
  constructor(readonly reason: string) { super(reason) }
}

type Files = Map<string, string>

/** The cron entry point: never throws; a failure is one error_log row. */
export async function runNightlyExport(env: Env): Promise<ExportOutcome> {
  try {
    return await nightlyExport(env)
  } catch (e) {
    const reason = e instanceof ExportError ? e.reason : 'failed'
    await writeErrorLog(env.DB, `export.${reason}`, EXPORT_ROUTE, 'worker').catch(() => {})
    return { status: 'failed', reason }
  }
}

async function nightlyExport(env: Env): Promise<ExportOutcome> {
  const token = env.EXPORT_GITHUB_TOKEN?.trim()
  const email = env.EXPORT_ACCOUNT_EMAIL?.trim()
  const repo = env.EXPORT_REPO?.trim()
  if (!token || !email || !repo) throw new ExportError('not-configured')
  if (!REPO.test(repo)) throw new ExportError('bad-repo')
  const { results } = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(email).all<{ id: string }>()
  if (results.length !== 1) throw new ExportError(results.length === 0 ? 'no-account' : 'many-accounts')
  const files = await buildFiles(env.DB, results[0]!.id)
  const entries = JSON.parse(files.get(`${EXPORT_DIR}/meta.json`)!).counts.entries as number
  const commit = await writeCommit(token, repo, files, `export: ${new Date().toISOString().slice(0, 10)} (${entries} entries)`)
  return commit ? { status: 'committed', commit, files: files.size, entries } : { status: 'unchanged', entries }
}

const monthOf = (createdAt: unknown) =>
  typeof createdAt === 'string' && /^\d{4}-\d{2}/.test(createdAt) ? createdAt.slice(0, 7) : 'undated'

/**
 * The repo files for one account, keyed by path. Pure of time: the same database gives the same bytes. A row pushed while
 * the pages are read comes back on a later page with a higher version; it replaces its earlier copy (and that copy's
 * revisions), so no row is written twice.
 */
export async function buildFiles(db: D1Database, userId: string, pageSize = PULL_MAX): Promise<Files> {
  type Entry = { id: string; createdAt: unknown }
  type Rec = { recordKind: string; id: string }
  const entries = new Map<string, { entry: Entry; revisions: unknown[] }>()
  const records = new Map<string, { record: Rec; revisions: unknown[] }>()
  const keyOf = (r: Rec) => `${r.recordKind}\u0000${r.id}`
  // delete + set: a replaced row moves to its new version's place, the order a single page would have given
  const put = <T>(m: Map<string, T>, k: string, v: T) => { m.delete(k); m.set(k, v) }
  let account: Record<string, unknown> = {}
  let since = 0
  let cursor = 0 // the last page's: the account's version this export reaches
  for (;;) {
    const page = await exportPage(db, { id: userId }, since, pageSize)
    if (since === 0) {
      const { account: a, identities, models, aiCalls, integrations } = page
      account = { account: a, identities, models, aiCalls, integrations }
    }
    for (const e of page.entries as Entry[]) put(entries, e.id, { entry: e, revisions: [] })
    for (const r of page.revisions) entries.get(r.id)?.revisions.push(r)
    for (const r of page.records as Rec[]) put(records, keyOf(r), { record: r, revisions: [] })
    for (const r of page.recordRevisions as Rec[]) records.get(keyOf(r))?.revisions.push(r)
    cursor = page.cursor
    if (!page.more) break
    if (page.cursor <= since) throw new ExportError('cursor-stuck') // a page that does not advance would loop forever
    since = page.cursor
  }
  const months = new Map<string, { entries: unknown[]; revisions: unknown[] }>()
  for (const { entry, revisions } of entries.values()) {
    const m = monthOf(entry.createdAt)
    const bucket = months.get(m) ?? { entries: [], revisions: [] }
    bucket.entries.push(entry)
    bucket.revisions.push(...revisions)
    months.set(m, bucket)
  }
  const json = (v: unknown) => `${JSON.stringify(v, null, 1)}
`
  const files: Files = new Map()
  const sorted = [...months.keys()].sort()
  for (const m of sorted) {
    const b = months.get(m)!
    files.set(`${EXPORT_DIR}/entries/${m}.json`, json({ format: EXPORT_FORMAT, month: m, entries: b.entries, revisions: b.revisions }))
  }
  const recs = [...records.values()]
  const recordRevisions = recs.flatMap((r) => r.revisions)
  files.set(`${EXPORT_DIR}/records.json`, json({ format: EXPORT_FORMAT, records: recs.map((r) => r.record), recordRevisions }))
  files.set(`${EXPORT_DIR}/account.json`, json({ format: EXPORT_FORMAT, ...account }))
  const revisionCount = sorted.reduce((n, m) => n + months.get(m)!.revisions.length, 0)
  files.set(`${EXPORT_DIR}/meta.json`, json({
    format: EXPORT_FORMAT, cursor, months: sorted,
    counts: { entries: entries.size, revisions: revisionCount, records: recs.length, recordRevisions: recordRevisions.length },
  }))
  return files
}

/** Git's blob id for a text file: SHA-1 of `blob <byte length>\0<bytes>`. Equal to what the tree listing reports. */
export async function blobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function gh<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...githubHeaders(token), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
  } catch {
    throw new ExportError('github-unreachable')
  }
  if (!res.ok) throw new ExportError(`github-${res.status}`)
  return (await res.json()) as T
}

/**
 * Writes `files` as one commit on the repo's default branch, replacing everything under `export/` (a file no longer
 * produced is removed) and leaving every other path alone. Returns the commit sha, or null when nothing differs.
 * Git Data API: ref → commit → root tree → `export` subtree (recursive) → new tree on base_tree → commit → ref. Blob ids
 * are computed here, so only changed files are uploaded and an unchanged night sends nothing.
 */
async function writeCommit(token: string, repo: string, files: Files, message: string): Promise<string | null> {
  const r = `/repos/${repo}`
  const { default_branch: branch } = await gh<{ default_branch: string }>(token, r)
  const refPath = branch.split('/').map(encodeURIComponent).join('/')
  const ref = await gh<{ object: { sha: string } }>(token, `${r}/git/ref/heads/${refPath}`)
  const parent = ref.object.sha
  const { tree: { sha: baseTree } } = await gh<{ tree: { sha: string } }>(token, `${r}/git/commits/${parent}`)
  type Listing = { tree: { path: string; type: string; sha: string }[]; truncated: boolean }
  // Only the export subtree is listed: whatever else the repo grows (trial/, …) cannot truncate this listing.
  const root = await gh<Listing>(token, `${r}/git/trees/${baseTree}`)
  const dir = root.tree.find((t) => t.path === EXPORT_DIR && t.type === 'tree')
  const remote = new Map<string, string>()
  if (dir) {
    const listing = await gh<Listing>(token, `${r}/git/trees/${dir.sha}?recursive=1`)
    if (listing.truncated) throw new ExportError('tree-truncated') // stale files could not be found; better no commit than a wrong one
    for (const t of listing.tree) if (t.type === 'blob') remote.set(`${EXPORT_DIR}/${t.path}`, t.sha)
  }
  const changed: { path: string; mode: string; type: string; content: string }[] = []
  for (const [path, content] of files) {
    if (remote.get(path) !== (await blobSha(content))) changed.push({ path, mode: '100644', type: 'blob', content })
  }
  const stale = [...remote.keys()].filter((p) => !files.has(p)).map((path) => ({ path, mode: '100644', type: 'blob', sha: null }))
  if (changed.length === 0 && stale.length === 0) return null
  const { sha: newTree } = await gh<{ sha: string }>(token, `${r}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree: [...changed, ...stale] } })
  const { sha: commit } = await gh<{ sha: string }>(token, `${r}/git/commits`, { method: 'POST', body: { message, tree: newTree, parents: [parent] } })
  // Not forced: if the branch moved since the read, GitHub refuses (422) and tomorrow's run starts from the new head.
  await gh(token, `${r}/git/refs/heads/${refPath}`, { method: 'PATCH', body: { sha: commit, force: false } })
  return commit
}
