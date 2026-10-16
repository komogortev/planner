// What the run modules share on the device, and the owner's note state tap. Harness v1 and the v1 journal lived here until
// D-113 retired copy and paste (R4): the harness runs in `loop2.ts`, the Summary in `summaryRun.ts`. Writes go through
// `writeRecords` (one transaction, outbox included); callers call `syncSoon()`, as capture does.
import { db } from '@/db'
import { writeRecords, type RecordWrite } from '@/db/records'
import { setNoteState, type NoteStatus } from '@/domain/harness'

/** The device's zone: always a valid IANA name, so `localDay` cannot throw on it (HW-HARNESS §9 point 7). */
export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export type Composed<H> = { prompt: string; header: H } | null
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }

/** Thrown when the header cannot be kept: a model's reply could not be checked against a run nobody remembers. */
export class PendingStorageError extends Error {
  constructor() {
    super('This browser refused to store the run (private mode or full storage), so its reply could not be checked. Nothing was sent.')
  }
}

/** Done · drop · carry to a day (state `open` with `followUpOn`). Records are never deleted: a state row is rewritten. */
export async function markNote(entryId: string, state: NoteStatus, followUpOn: string | null = null, now = new Date().toISOString()): Promise<Outcome<number>> {
  const w = await writeRecords(db, [{ recordKind: 'entryState', row: setNoteState(entryId, state, now, followUpOn) as unknown as RecordWrite['row'] }], now)
  return w.ok ? { ok: true, value: w.written } : { ok: false, error: `Nothing was stored: ${w.errors.slice(0, 3).join('; ')}` }
}
