// Writing harness / widget records on the device (HW-HARNESS.md §5): a record and its outbox row commit in ONE Dexie
// transaction, exactly like `captureEntry` for a note. Sync is later and never gates the write.
import type { Table } from 'dexie'
import { cleanRecord, flatten, RECORD_KINDS, RECORD_TABLE, type CleanRecord, type RecordKind } from '@/domain/records'
import type { PlannerDb } from '.'

/** The key a record has in the outbox and in "which rows are waiting" sets: never the bare id (an entryState has its entry's id). */
export const outboxKey = (recordKind: RecordKind, id: string): string => `${recordKind}/${id}`

/** The bare record id out of an outbox key. */
export const recordIdOf = (recordKind: RecordKind, key: string): string => key.slice(recordKind.length + 1)

/** Every record table of a device, for a transaction that must cover them all. */
export const recordTables = (db: PlannerDb): Table<any, string>[] => RECORD_KINDS.map((k) => db.table(RECORD_TABLE[k]))

export type RecordWrite = { recordKind: RecordKind; row: Record<string, unknown> & { id: string } }
export type WriteResult = { ok: true; written: number } | { ok: false; errors: string[] }

/**
 * Validate every record first (one bad one writes nothing), then store them and queue one outbox row each, atomically.
 * A record whose content is already what the device holds is skipped — pasting a result twice must not queue the same
 * change twice. A rewrite of a synced row is based on the version the device holds (§6.3). `deletedAt` defaults to null: the
 * domain types do not carry it, the wire form requires it.
 */
export async function writeRecords(db: PlannerDb, writes: RecordWrite[], now: string): Promise<WriteResult> {
  const cleaned: CleanRecord[] = []
  const errors: string[] = []
  for (const w of writes) {
    const c = cleanRecord(w.recordKind, { deletedAt: null, ...w.row })
    if (c.ok) cleaned.push(c.value)
    else errors.push(...c.errors.map((e) => `${w.recordKind} ${w.row.id}: ${e}`))
  }
  if (errors.length) return { ok: false, errors }
  let written = 0
  await db.transaction('rw', [db.outbox, ...recordTables(db)], async () => {
    for (const rec of cleaned) {
      const table = db.table(RECORD_TABLE[rec.recordKind])
      const held = (await table.get(rec.id)) as ({ serverVersion: number | null } & Record<string, unknown>) | undefined
      const row = flatten(rec)
      if (held) {
        const { serverVersion: _v, ...heldFields } = held
        // `flatten` writes keys in the validator's order; a stored row may not, so compare by value, not by text.
        if (JSON.stringify(sortKeys(heldFields)) === JSON.stringify(sortKeys(row))) continue
      }
      const baseVersion = held?.serverVersion ?? null
      await table.put({ ...row, serverVersion: baseVersion })
      await db.outbox.add({
        entityId: outboxKey(rec.recordKind, rec.id),
        recordKind: rec.recordKind,
        op: rec.deletedAt ? 'delete' : 'upsert',
        baseVersion,
        payload: row as Record<string, unknown> & { id: string },
        attempts: 0,
        lastError: null,
        queuedAt: now,
      })
      written++
    }
  })
  return { ok: true, written }
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
}
