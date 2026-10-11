// Capture (H1-ENTRIES.md section 4): an entry is captured when it and its outbox row commit in ONE Dexie transaction.
// Sync is later and never gates capture — a failed or absent sync leaves the outbox row, nothing is lost.
import { cleanEntry } from '@/domain/clean'
import type { Entry } from '@/domain/entry'
import { db, type PlannerDb } from '@/db'
import { nowISO } from '@/utils/dates'
import { uuid } from '@/utils/uuid'

export type CaptureResult = { ok: true; entry: Entry } | { ok: false; error: string }

export async function captureEntry(rawBody: string, database: PlannerDb = db): Promise<CaptureResult> {
  const now = nowISO()
  const cleaned = cleanEntry({
    id: uuid(),
    body: rawBody,
    createdAt: now,
    occurredAt: null,
    categoryId: null, // Inbox
    tags: [],
    origin: 'author',
    updatedAt: now,
    deletedAt: null,
  })
  if (!cleaned.ok) return { ok: false, error: cleaned.errors.join('; ') }
  const input = cleaned.value
  const entry: Entry = { ...input, serverVersion: null }
  await database.transaction('rw', database.entries, database.outbox, async () => {
    await database.entries.add(entry)
    await database.outbox.add({
      entityId: entry.id,
      op: 'upsert',
      baseVersion: null,
      payload: input,
      attempts: 0,
      lastError: null,
      queuedAt: now,
    })
  })
  return { ok: true, entry }
}
