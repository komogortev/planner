// The D-58 sweep's restore-edit step (A7), kept out of engine.ts: what a page of a sweep from 0 hands back to the outbox.
import type { PlannerDb } from '@/db'
import { outboxKey } from '@/db/records'
import { RECORD_KINDS, RECORD_TABLE } from '@/domain/records'
import type { Entry } from '@/domain/entry'
import type { RecordWire } from './engine'

/**
 * During a sweep from 0 (D-58, A7): a row the server returns at a version BELOW the one this device acknowledged for it is
 * the copy a restore put back. The edits acknowledged after the restore point (a Task done, an answer, a removal) exist only
 * on the devices, so the device's row is not overwritten: it goes back into the outbox, and its id joins `queued`, which
 * keeps the page from applying over it. The edit is based on the version this device acknowledged, which the server no
 * longer has: the server takes it as stale, applies it, and keeps what it replaced as a revision. Called inside the page's transaction, which
 * covers the entries, the outbox and every record table.
 * Not decided by `updatedAt` (a display clock, never a judge, §5.1). Known limit: a row another device edited after the
 * restore, at a version still below this device's, is overwritten by this device's older edit; that edit is in the
 * server's revisions, not lost.
 */
export async function requeueRestored(db: PlannerDb, changes: Entry[], incoming: RecordWire[], queued: Set<string>, queuedAt: string): Promise<boolean> {
  let requeued = 0
  const older = (held: { serverVersion: number | null } | undefined, v: unknown): v is number =>
    !!held && held.serverVersion !== null && typeof v === 'number' && v < held.serverVersion
  const notes = changes.filter((c) => typeof c?.id === 'string' && !queued.has(c.id))
  const held = await db.entries.bulkGet(notes.map((c) => c.id))
  for (const [i, c] of notes.entries()) {
    const e = held[i]
    if (!older(e, c.serverVersion)) continue
    const { serverVersion: _version, ...payload } = e!
    await db.outbox.add({ entityId: e!.id, op: e!.deletedAt ? 'delete' : 'upsert', baseVersion: e!.serverVersion, payload, attempts: 0, lastError: null, queuedAt })
    await db.entries.update(e!.id, { serverVersion: c.serverVersion })
    queued.add(e!.id)
    requeued++
  }
  for (const kind of RECORD_KINDS) {
    const rows = incoming.filter((r) => r?.recordKind === kind && typeof r.id === 'string' && !queued.has(outboxKey(kind, r.id)))
    if (rows.length === 0) continue
    const table = db.table(RECORD_TABLE[kind])
    const mine = await table.bulkGet(rows.map((r) => r.id))
    for (const [i, r] of rows.entries()) {
      const row = mine[i]
      if (!older(row, r.serverVersion)) continue
      const { serverVersion: _version, ...payload } = row
      await db.outbox.add({
        entityId: outboxKey(kind, row.id), recordKind: kind, op: row.deletedAt ? 'delete' : 'upsert', baseVersion: row.serverVersion, payload, attempts: 0, lastError: null,
        queuedAt,
      })
      await table.update(row.id, { serverVersion: r.serverVersion })
      queued.add(outboxKey(kind, row.id))
      requeued++
    }
  }
  return requeued > 0
}
