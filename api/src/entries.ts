// The only module that reads or writes `entries` / `entry_revisions`. Every function takes `userId` as a required
// argument and every statement filters on it, so account isolation (H1 §8) lives in one place. The id comes from the
// session, never from a request body.
//
// Push (§6.1/§6.3) is one read and one write round trip per round — D1's free plan allows 50 queries per invocation.
// Decisions are made in JS from rows that were read; the write batch re-checks each one in SQL (compare-and-swap on
// the entity's own `server_version`), so a push that raced another device's is retried, never applied blindly.
import { cleanEntry, type CleanEntry } from '../../src/domain/clean'
import type { Entry } from '../../src/domain/entry'

export const PUSH_MAX_MUTATIONS = 100
// Bounds the CPU a push can cost (cleaning normalises every body). A client splits a flush by size as well as count.
export const PUSH_MAX_BYTES = 1_000_000
export const PULL_MAX = 500
// Rounds per push: several mutations of one entity in a request take one round each, and a lost race costs one more.
const ROUNDS = 4

export type PushResult = {
  entityId: string
  /** `retry`: still pending after the last round (lost races, or a long chain for one entity) — push the row again. */
  status: 'applied' | 'duplicate' | 'rejected' | 'retry'
  serverVersion?: number
  conflict?: boolean
  error?: string
}

type Row = Omit<Entry, 'serverVersion'> & { version: number }
type Raw = {
  id: string; body: string; created_at: string; occurred_at: string | null; category_id: string | null
  tags: string; origin: 'author'; updated_at: string; deleted_at: string | null; server_version: number
}

const COLS = 'id, body, created_at, occurred_at, category_id, tags, origin, updated_at, deleted_at, server_version'

const toRow = (r: Raw): Row => ({
  id: r.id, body: r.body, createdAt: r.created_at, occurredAt: r.occurred_at, categoryId: r.category_id,
  tags: JSON.parse(r.tags) as string[], origin: r.origin, updatedAt: r.updated_at, deletedAt: r.deleted_at, version: r.server_version,
})

const toEntry = (r: Raw): Entry => {
  const { version, ...rest } = toRow(r)
  return { ...rest, serverVersion: version }
}

// ── push ────────────────────────────────────────────────────────────────────

type Item = { index: number; entityId: string; baseVersion: number | null; entry: CleanEntry }
type Apply = { kind: 'apply'; next: CleanEntry; cur: Row | undefined; revision: boolean; conflict: boolean }
type Decision = { kind: 'duplicate'; version: number } | Apply

/** Same stored content? `updatedAt` is the device's display clock and never decides anything (§5.1). */
function sameContent(a: Omit<Row, 'version' | 'updatedAt'>, b: Omit<Row, 'version' | 'updatedAt'>): boolean {
  return a.body === b.body && a.createdAt === b.createdAt && a.occurredAt === b.occurredAt && a.categoryId === b.categoryId
    && a.origin === b.origin && a.deletedAt === b.deletedAt && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i])
}

/**
 * What one mutation does to the row it finds (§6.3).
 *  - same content → duplicate: replaying a push changes nothing.
 *  - otherwise apply, and keep the replaced text in revisions when the edit was made against an older version, or
 *    replaces a deleted entry's text.
 *  - a deleted entry stays deleted (`deletedAt` is kept): an edit from a device that has not pulled the delete yet
 *    must not bring the entry back. Its text is applied, with the earlier text in revisions — nothing is lost.
 */
function decide(cur: Row | undefined, item: Item): Decision {
  const e = item.entry
  const next = { ...e, deletedAt: cur?.deletedAt ?? e.deletedAt }
  if (!cur) return { kind: 'apply', next, cur, revision: false, conflict: false }
  if (sameContent(cur, next)) return { kind: 'duplicate', version: cur.version }
  const stale = item.baseVersion !== cur.version
  const resurrect = e.deletedAt === null && cur.deletedAt !== null
  return { kind: 'apply', next, cur, revision: stale || cur.deletedAt !== null, conflict: stale || resurrect }
}

async function snapshot(db: D1Database, userId: string, ids: string[]): Promise<Map<string, Row>> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM entries WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`)
    .bind(userId, JSON.stringify(ids))
    .all<Raw>()
  return new Map(results.map((r) => [r.id, toRow(r)]))
}

/** Test seam: runs between the read and the write of a round — where another device's push could land. */
export type PushHooks = { afterRead?: () => Promise<void> }

/**
 * Applies a device's outbox rows for `userId`, in order. `mutations` is untrusted JSON; results come back in the same
 * order. The caller has already bounded the count and the size.
 *
 * Each round takes the first pending mutation of every entity, so a decision is always made against a row that was
 * read, never one predicted. A mutation whose row moved between the read and the write goes round again.
 */
export async function pushMutations(db: D1Database, userId: string, mutations: unknown[], hooks: PushHooks = {}): Promise<PushResult[]> {
  const results: (PushResult | undefined)[] = new Array(mutations.length)
  let todo: Item[] = []

  mutations.forEach((m, index) => {
    const r = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {}
    const entityId = typeof r.entityId === 'string' ? r.entityId.toLowerCase() : ''
    const reject = (error: string) => { results[index] = { entityId, status: 'rejected', error } }
    if (r.op !== 'upsert' && r.op !== 'delete') return reject('op: not upsert or delete')
    const baseVersion = r.baseVersion
    if (baseVersion !== null && !(typeof baseVersion === 'number' && Number.isSafeInteger(baseVersion) && baseVersion >= 1)) {
      return reject('baseVersion: not a version or null')
    }
    const cleaned = cleanEntry(r.payload)
    if (!cleaned.ok) return reject(cleaned.errors.join('; '))
    if (cleaned.value.id !== entityId) return reject('entityId: does not match the payload id')
    if (r.op === 'delete' && cleaned.value.deletedAt === null) return reject('delete: payload has no deletedAt')
    todo.push({ index, entityId, baseVersion: baseVersion as number | null, entry: cleaned.value })
  })

  for (let round = 0; round < ROUNDS && todo.length > 0; round++) {
    const seen = new Set<string>()
    const current: Item[] = []
    const later: Item[] = []
    for (const t of todo) {
      if (seen.has(t.entityId)) later.push(t)
      else { seen.add(t.entityId); current.push(t) }
    }

    const rows = await snapshot(db, userId, current.map((t) => t.entityId))
    await hooks.afterRead?.()

    const plans: { item: Item; d: Apply }[] = []
    for (const item of current) {
      const d = decide(rows.get(item.entityId), item)
      if (d.kind === 'duplicate') results[item.index] = { entityId: item.entityId, status: 'duplicate', serverVersion: d.version }
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
              `INSERT OR IGNORE INTO entry_revisions (user_id, id, server_version, body, deleted_at, replaced_at, meta)
               SELECT user_id, id, server_version, body, deleted_at, ?,
                 json_object('createdAt', created_at, 'occurredAt', occurred_at, 'categoryId', category_id, 'tags', json(tags), 'updatedAt', updated_at)
               FROM entries WHERE user_id = ? AND id = ? AND server_version = ?`,
            ).bind(now, userId, item.entityId, d.cur.version),
          )
        }
        // The new version is read after this transaction's own increment, so each applied mutation gets the next number.
        // The upsert only takes effect while the row is still the version the decision was made on; otherwise it
        // returns nothing and the mutation goes round again.
        upsertAt.push(stmts.length)
        stmts.push(
          db.prepare(
            `INSERT INTO entries (user_id, id, body, created_at, occurred_at, category_id, tags, origin, updated_at, deleted_at, server_version, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT version_seq FROM users WHERE id = ?), ?)
             ON CONFLICT (user_id, id) DO UPDATE SET body = excluded.body, created_at = excluded.created_at, occurred_at = excluded.occurred_at,
               category_id = excluded.category_id, tags = excluded.tags, origin = excluded.origin, updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at, server_version = excluded.server_version, received_at = excluded.received_at
               WHERE entries.server_version IS ?
             RETURNING server_version`,
          ).bind(
            userId, item.entityId, d.next.body, d.next.createdAt, d.next.occurredAt, d.next.categoryId, JSON.stringify(d.next.tags),
            d.next.origin, d.next.updatedAt, d.next.deletedAt, userId, now, d.cur?.version ?? null,
          ),
        )
      }
      const out = await db.batch<{ server_version: number }>(stmts)
      plans.forEach(({ item, d }, i) => {
        const got = out[upsertAt[i]].results[0]
        if (got) {
          results[item.index] = { entityId: item.entityId, status: 'applied', serverVersion: got.server_version, ...(d.conflict ? { conflict: true } : {}) }
        } else {
          retry.push(item)
        }
      })
    }
    todo = [...retry, ...later].sort((a, b) => a.index - b.index)
  }
  for (const item of todo) results[item.index] = { entityId: item.entityId, status: 'retry' }
  return results as PushResult[]
}

// ── pull / query ────────────────────────────────────────────────────────────

/** Rows after `since`, oldest first, soft-deleted ones included so a delete reaches every device (§6.2). */
export async function pullChanges(db: D1Database, userId: string, since: number, limit: number) {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM entries WHERE user_id = ? AND server_version > ? ORDER BY server_version LIMIT ?`)
    .bind(userId, since, limit + 1)
    .all<Raw>()
  const more = results.length > limit
  const changes = results.slice(0, limit).map(toEntry)
  return { changes, cursor: changes.length ? changes[changes.length - 1].serverVersion! : since, more }
}

/** One entry, or null when it does not exist *for this account* — another account's id looks the same as a missing one. */
export async function getEntry(db: D1Database, userId: string, id: string): Promise<Entry | null> {
  const r = await db.prepare(`SELECT ${COLS} FROM entries WHERE user_id = ? AND id = ?`).bind(userId, id.toLowerCase()).first<Raw>()
  return r ? toEntry(r) : null
}

export type EntryQuery = {
  /** UTC day, inclusive, on `createdAt`. */
  from?: string
  to?: string
  /** Case-insensitive (ASCII) substring of the body — the H1 text query (§12 Q7); FTS5 when search becomes a feature. */
  q?: string
  includeDeleted?: boolean
  limit: number
  /** `next` from the previous page. */
  cursor?: { createdAt: string; id: string }
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString()

/** Newest first. `next` is the cursor for the following page, or null on the last one. */
export async function queryEntries(db: D1Database, userId: string, q: EntryQuery) {
  const where = ['user_id = ?']
  const args: (string | number)[] = [userId]
  if (!q.includeDeleted) where.push('deleted_at IS NULL')
  if (q.from) { where.push('created_at >= ?'); args.push(`${q.from}T00:00:00.000Z`) }
  if (q.to) { where.push('created_at < ?'); args.push(nextDay(q.to)) }
  if (q.q) {
    // Not LIKE: D1 refuses a LIKE/GLOB pattern over 50 bytes, and escaping % and _ would double a short query past it.
    // lower() folds ASCII only, which is what LIKE did.
    where.push('instr(lower(body), lower(?)) > 0')
    args.push(q.q)
  }
  if (q.cursor) { where.push('(created_at, id) < (?, ?)'); args.push(q.cursor.createdAt, q.cursor.id) }
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM entries WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...args, q.limit + 1)
    .all<Raw>()
  const page = results.slice(0, q.limit)
  const last = page[page.length - 1]
  return {
    entries: page.map(toEntry),
    next: results.length > q.limit && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}
