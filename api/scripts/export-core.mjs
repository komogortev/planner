// The local planner export (api/scripts/export-local.mjs), minus wrangler: builds the file Settings → Export downloads
// (`GET /me/export` pages, api/src/account.ts `exportPage`, joined by src/auth/accountExport.ts) from plain SELECTs, plus
// the account's `version_seq`. `query(sql)` runs one statement and resolves to its rows; the script runs it through
// `wrangler d1 execute`, api/test/exportLocal.test.ts through the test D1 — and asserts the result equals the real join.
// Literals are inlined (the CLI takes no bound parameters), so every statement passes `assertSelect` first.

export const EXPORT_FORMAT = 1 // api/src/account.ts
export const PULL_MAX = 500 // api/src/entries.ts: the page size the app's export gets

const WRITE_WORDS = /\b(insert|update|delete|replace|upsert|drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release)\b/i

/** Throws unless `sql` is one SELECT (or WITH … SELECT) statement with no write keyword outside its string literals. */
export function assertSelect(sql) {
  const bare = String(sql).replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;$/, '')
  if (!/^(select|with)\b/i.test(bare)) throw new Error(`refused: not a SELECT: ${bare.slice(0, 40)}`)
  if (bare.includes(';')) throw new Error('refused: more than one statement')
  if (/'/.test(bare.replace(/''/g, ''))) throw new Error('refused: unbalanced quote')
  const word = bare.match(WRITE_WORDS)
  if (word) throw new Error(`refused: ${word[0]} in a read-only export`)
  return sql
}

export const sq = (s) => `'${String(s).replace(/'/g, "''")}'`

/**
 * The whole export for `email`; throws `NoAccountError` when no account has that email. Pages exactly as the app does
 * (`limit`, default PULL_MAX), so array order matches the downloaded file.
 */
export async function buildExport(query, email, { limit = PULL_MAX, now = Date.now } = {}) {
  const q = (sql) => query(assertSelect(sql))
  const users = await q(`SELECT id, email, name, created_at AS createdAt, version_seq FROM users WHERE email = ${sq(email)}`)
  if (users.length === 0) throw new NoAccountError(`no account has that email (${users.length} rows)`)
  if (users.length > 1) throw new Error(`${users.length} accounts for that email`)
  const { version_seq: versionSeq, ...account } = users[0]
  const uid = sq(account.id)
  const identities = await q(`SELECT provider FROM identities WHERE user_id = ${uid} ORDER BY provider`)

  const entries = []
  const revisions = []
  const records = []
  const recordRevisions = []
  let since = 0
  for (let guard = 0; guard < 100_000; guard++) {
    // api/src/records.ts `pullAll`: both tables asked for limit + 1 rows, merged in version order, the first `limit` kept.
    const e = await q(`SELECT id, body, created_at, occurred_at, category_id, tags, origin, updated_at, deleted_at, server_version FROM entries WHERE user_id = ${uid} AND server_version > ${since} ORDER BY server_version LIMIT ${limit + 1}`)
    const r = await q(`SELECT kind, id, data, deleted_at, server_version FROM records WHERE user_id = ${uid} AND server_version > ${since} ORDER BY server_version LIMIT ${limit + 1}`)
    const merged = [...e.map((row) => ({ v: row.server_version, entry: row })), ...r.map((row) => ({ v: row.server_version, record: row }))].sort((a, b) => a.v - b.v)
    const more = merged.length > limit
    const page = merged.slice(0, limit)
    if (page.length === 0) break
    const cursor = page[page.length - 1].v
    for (const p of page) {
      if (p.entry) {
        const x = p.entry // api/src/entries.ts `toEntry`
        entries.push({ id: x.id, body: x.body, createdAt: x.created_at, occurredAt: x.occurred_at, categoryId: x.category_id, tags: JSON.parse(x.tags), origin: x.origin, updatedAt: x.updated_at, deletedAt: x.deleted_at, serverVersion: x.server_version })
      } else {
        const x = p.record
        records.push({ recordKind: x.kind, id: x.id, ...JSON.parse(x.data), deletedAt: x.deleted_at, serverVersion: x.server_version })
      }
    }
    // `revisionsFor` / `recordRevisionsFor` take the page's ids; the rows of a page are exactly those with a version in
    // (since, cursor], which keeps the statement short (the ids of 500 rows would overrun a Windows command line).
    const range = `c.user_id = ${uid} AND c.server_version > ${since} AND c.server_version <= ${cursor}`
    for (const x of await q(`SELECT r.id, r.server_version AS replacedVersion, r.body, r.deleted_at AS deletedAt, r.replaced_at AS replacedAt, r.meta FROM entry_revisions r WHERE r.user_id = ${uid} AND r.id IN (SELECT c.id FROM entries c WHERE ${range}) ORDER BY r.id, r.server_version`)) {
      revisions.push({ ...x, meta: x.meta ? JSON.parse(x.meta) : null })
    }
    for (const x of await q(`SELECT r.kind AS recordKind, r.id, r.server_version AS replacedVersion, r.data, r.deleted_at AS deletedAt, r.replaced_at AS replacedAt FROM record_revisions r JOIN records c ON r.user_id = c.user_id AND r.kind = c.kind AND r.id = c.id WHERE ${range} ORDER BY r.kind, r.id, r.server_version`)) {
      recordRevisions.push({ ...x, data: JSON.parse(x.data) })
    }
    if (!more) break
    since = cursor
  }
  return { format: EXPORT_FORMAT, exportedAt: now(), account, identities, entries, revisions, records, recordRevisions, version_seq: versionSeq }
}

export class NoAccountError extends Error {}

/** `planner-export-YYYY-MM-DD.json` on the local calendar day (Settings → Export names it by the UTC day). */
export function exportFileName(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `planner-export-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}.json`
}
