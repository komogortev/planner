// The only module that reads or writes `records` / `record_revisions` (HW-HARNESS.md §5, D-62), plus the merged pull. Same
// rules as entries.ts, which it deliberately mirrors and does not touch: every function takes `userId` and every statement
// filters on it (account isolation, H1 §8); a push is one read and one write round trip per round (D1's free plan allows 50
// queries per invocation); decisions are made in JS from rows that were read, and the write batch re-checks each one in SQL
// (compare-and-swap on the row's own `server_version`), so a push that raced another device's is retried, never applied blindly.
//
// Differences from entries, all on purpose: no cleaning of free text beyond what `cleanRecord` does (the validator is the
// shared authority); content is compared as the validator's fixed-order JSON text; a key added to a kind later
// (`ADDED_FIELDS`) that a push lacks keeps the stored value instead of being erased (`restoreAbsent`).
import { cleanRecord, isRecordKind, restoreAbsent, type CleanRecord, type RecordKind } from '../../src/domain/records'
import { COLS, toEntry, type PushResult, type Raw } from './entries'

// Rounds per push: several mutations of one record in a request take one round each, and a lost race costs one more.
const ROUNDS = 4

type Stored = { data: string; deletedAt: string | null; version: number }
// `pushed` is the record as validated; `rec`/`data` are what this round would write (after `restoreAbsent` against the row read).
type Item = { index: number; recordKind: RecordKind; id: string; baseVersion: number | null; pushed: CleanRecord; rec: CleanRecord; data: string }
type Apply = { kind: 'apply'; deletedAt: string | null; cur: Stored | undefined; revision: boolean; conflict: boolean }
type Decision = { kind: 'duplicate'; version: number } | Apply

const slot = (recordKind: string, id: string) => `${recordKind}/${id}`

/**
 * What one mutation does to the row it finds — entries.ts `decide`, restated for text content.
 *  - same content → duplicate: replaying a push changes nothing.
 *  - otherwise apply, keeping the replaced content when the edit was made against an older version or replaces a deleted row.
 *  - a deleted record stays deleted: an edit from a device that has not pulled the delete must not bring it back.
 */
function decide(cur: Stored | undefined, item: Item): Decision {
  const deletedAt = cur?.deletedAt ?? item.rec.deletedAt
  if (!cur) return { kind: 'apply', deletedAt, cur, revision: false, conflict: false }
  if (cur.data === item.data && cur.deletedAt === deletedAt) return { kind: 'duplicate', version: cur.version }
  const stale = item.baseVersion !== cur.version
  const resurrect = item.rec.deletedAt === null && cur.deletedAt !== null
  return { kind: 'apply', deletedAt, cur, revision: stale || cur.deletedAt !== null, conflict: stale || resurrect }
}

async function snapshot(db: D1Database, userId: string, items: Item[]): Promise<Map<string, Stored>> {
  // Primary-key lookups, one per pair: joining on json_each keeps it one statement without scanning the account's records.
  const { results } = await db
    .prepare(
      `SELECT r.kind, r.id, r.data, r.deleted_at, r.server_version
       FROM json_each(?) j JOIN records r
         ON r.user_id = ? AND r.kind = json_extract(j.value, '$[0]') AND r.id = json_extract(j.value, '$[1]')`,
    )
    .bind(JSON.stringify(items.map((t) => [t.recordKind, t.id])), userId)
    .all<{ kind: string; id: string; data: string; deleted_at: string | null; server_version: number }>()
  return new Map(results.map((r) => [slot(r.kind, r.id), { data: r.data, deletedAt: r.deleted_at, version: r.server_version }]))
}

/** Test seam: runs between the read and the write of a round — where another device's push could land. */
export type PushHooks = { afterRead?: () => Promise<void> }

/**
 * Applies a device's record mutations for `userId`, in order. `mutations` is untrusted JSON, each naming its `recordKind`;
 * results come back in the same order. The caller has already bounded the count and the size.
 */
export async function pushRecords(db: D1Database, userId: string, mutations: unknown[], hooks: PushHooks = {}): Promise<PushResult[]> {
  const results: (PushResult | undefined)[] = new Array(mutations.length)
  let todo: Item[] = []

  mutations.forEach((m, index) => {
    const r = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {}
    const entityId = typeof r.entityId === 'string' ? r.entityId.toLowerCase() : ''
    const reject = (error: string) => { results[index] = { entityId, status: 'rejected', error } }
    if (!isRecordKind(r.recordKind)) return reject('recordKind: unknown')
    if (r.op !== 'upsert' && r.op !== 'delete') return reject('op: not upsert or delete')
    const baseVersion = r.baseVersion
    if (baseVersion !== null && !(typeof baseVersion === 'number' && Number.isSafeInteger(baseVersion) && baseVersion >= 1)) {
      return reject('baseVersion: not a version or null')
    }
    const cleaned = cleanRecord(r.recordKind, r.payload)
    if (!cleaned.ok) return reject(cleaned.errors.join('; '))
    if (cleaned.value.id !== entityId) return reject('entityId: does not match the payload id')
    if (r.op === 'delete' && cleaned.value.deletedAt === null) return reject('delete: payload has no deletedAt')
    todo.push({ index, recordKind: r.recordKind, id: entityId, baseVersion: baseVersion as number | null, pushed: cleaned.value, rec: cleaned.value, data: JSON.stringify(cleaned.value.fields) })
  })

  for (let round = 0; round < ROUNDS && todo.length > 0; round++) {
    const seen = new Set<string>()
    const current: Item[] = []
    const later: Item[] = []
    for (const t of todo) {
      const k = slot(t.recordKind, t.id)
      if (seen.has(k)) later.push(t)
      else { seen.add(k); current.push(t) }
    }

    const rows = await snapshot(db, userId, current)
    await hooks.afterRead?.()

    const plans: { item: Item; d: Apply }[] = []
    for (const item of current) {
      const cur = rows.get(slot(item.recordKind, item.id))
      // Recomputed every round from what was pushed: a lost race means the stored row (and its values) may have changed.
      const restored = cur ? restoreAbsent(item.pushed, cur.data) : { ok: true as const, value: item.pushed }
      if (!restored.ok) {
        results[item.index] = { entityId: item.id, status: 'rejected', error: restored.errors.join('; ') }
        continue
      }
      item.rec = restored.value
      item.data = JSON.stringify(restored.value.fields)
      const d = decide(cur, item)
      if (d.kind === 'duplicate') results[item.index] = { entityId: item.id, status: 'duplicate', serverVersion: d.version }
      else plans.push({ item, d })
    }

    const retry: Item[] = []
    if (plans.length > 0) {
      const now = Date.now()
      const stmts: D1PreparedStatement[] = []
      const upsertAt: number[] = []
      for (const { item, d } of plans) {
        stmts.push(db.prepare('UPDATE users SET version_seq = version_seq + 1 WHERE id = ?').bind(userId))
        if (d.revision && d.cur) {
          // Guarded by the version the decision was made on, so a row that moved keeps no stale copy.
          stmts.push(
            db.prepare(
              `INSERT OR IGNORE INTO record_revisions (user_id, kind, id, server_version, data, deleted_at, replaced_at)
               SELECT user_id, kind, id, server_version, data, deleted_at, ?
               FROM records WHERE user_id = ? AND kind = ? AND id = ? AND server_version = ?`,
            ).bind(now, userId, item.recordKind, item.id, d.cur.version),
          )
        }
        // The new version is read after this transaction's own increment, so each applied mutation gets the next number.
        // The upsert only takes effect while the row is still the version the decision was made on; otherwise it returns
        // nothing and the mutation goes round again.
        upsertAt.push(stmts.length)
        stmts.push(
          db.prepare(
            `INSERT INTO records (user_id, kind, id, data, deleted_at, server_version, received_at)
             VALUES (?, ?, ?, ?, ?, (SELECT version_seq FROM users WHERE id = ?), ?)
             ON CONFLICT (user_id, kind, id) DO UPDATE SET data = excluded.data, deleted_at = excluded.deleted_at,
               server_version = excluded.server_version, received_at = excluded.received_at
               WHERE records.server_version IS ?
             RETURNING server_version`,
          ).bind(userId, item.recordKind, item.id, item.data, d.deletedAt, userId, now, d.cur?.version ?? null),
        )
      }
      const out = await db.batch<{ server_version: number }>(stmts)
      plans.forEach(({ item, d }, i) => {
        const got = out[upsertAt[i]!]!.results[0]
        if (got) results[item.index] = { entityId: item.id, status: 'applied', serverVersion: got.server_version, ...(d.conflict ? { conflict: true } : {}) }
        else retry.push(item)
      })
    }
    todo = [...retry, ...later].sort((a, b) => a.index - b.index)
  }
  for (const item of todo) results[item.index] = { entityId: item.id, status: 'retry' }
  return results as PushResult[]
}

// ── pull ────────────────────────────────────────────────────────────────────

type RawRecord = { kind: string; id: string; data: string; deleted_at: string | null; server_version: number }

/**
 * One page of every change after `since`, entries and records merged in version order under ONE cursor (§6.2).
 *
 * Both tables draw their versions from the account's single counter, so no two rows share a version and the merge is a plain
 * sort. Each side is asked for `limit + 1` rows: the true first `limit + 1` of the union are all inside those two lists.
 * `changes` holds the entries of the page exactly as before; `records` is added only when the page has any, so a client
 * that knows nothing of records sees the same answer it always did — with a cursor that has moved past them.
 * `head` as in entries.ts `pullChanges` (D-58). One batch: one round trip, one query on the free plan.
 */
export async function pullAll(db: D1Database, userId: string, since: number, limit: number) {
  const [e, r, head] = await db.batch([
    db.prepare(`SELECT ${COLS} FROM entries WHERE user_id = ? AND server_version > ? ORDER BY server_version LIMIT ?`).bind(userId, since, limit + 1),
    db.prepare('SELECT kind, id, data, deleted_at, server_version FROM records WHERE user_id = ? AND server_version > ? ORDER BY server_version LIMIT ?').bind(userId, since, limit + 1),
    db.prepare('SELECT version_seq FROM users WHERE id = ?').bind(userId),
  ])
  const merged = [
    ...(e!.results as Raw[]).map((row) => ({ version: row.server_version, entry: row })),
    ...(r!.results as RawRecord[]).map((row) => ({ version: row.server_version, record: row })),
  ].sort((a, b) => a.version - b.version)
  const more = merged.length > limit
  const page = merged.slice(0, limit)
  const changes = page.flatMap((p) => ('entry' in p ? [toEntry(p.entry)] : []))
  const records = page.flatMap((p) =>
    'record' in p
      ? [{ recordKind: p.record.kind, id: p.record.id, ...(JSON.parse(p.record.data) as object), deletedAt: p.record.deleted_at, serverVersion: p.record.server_version }]
      : [],
  )
  return {
    changes,
    ...(records.length ? { records } : {}),
    cursor: page.length ? page[page.length - 1]!.version : since,
    more,
    // Absent when the account is not there any more: "0" would tell a client the server is empty (see entries.ts).
    ...((head!.results[0] as { version_seq: number } | undefined) ? { head: (head!.results[0] as { version_seq: number }).version_seq } : {}),
  }
}

/** Every revision kept for these records of this account, for the account export (S2b). */
export async function recordRevisionsFor(db: D1Database, userId: string, keys: { kind: string; id: string }[]) {
  if (keys.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT r.kind AS recordKind, r.id, r.server_version AS replacedVersion, r.data, r.deleted_at AS deletedAt, r.replaced_at AS replacedAt
       FROM json_each(?) j JOIN record_revisions r
         ON r.user_id = ? AND r.kind = json_extract(j.value, '$[0]') AND r.id = json_extract(j.value, '$[1]')
       ORDER BY r.kind, r.id, r.server_version`,
    )
    .bind(JSON.stringify(keys.map((k) => [k.kind, k.id])), userId)
    .all<{ recordKind: string; id: string; replacedVersion: number; data: string; deletedAt: string | null; replacedAt: number }>()
  return results.map((r) => ({ ...r, data: JSON.parse(r.data) as unknown }))
}
