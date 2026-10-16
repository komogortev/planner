/** Dexie row types for the sync layer: the outbox and the per-account pull cursor. Domain records live in `src/domain/`. */

// --- H1 entries (Dexie v4, H1-ENTRIES.md section 5.1) ---

/** One queued change to ship to the backend. `payload` is the FULL entry at queue time (never a partial edit). */
export interface OutboxRow {
  seq?: number // auto-increment: flush order
  entityId: string
  op: 'upsert' | 'delete'
  baseVersion: number | null // serverVersion the edit was made against
  /** An entry's full input, or — when `recordKind` is set — a harness record's full wire form (`{ id, ...fields, deletedAt }`). */
  payload: import('@/domain/entry').EntryInput | (Record<string, unknown> & { id: string })
  /**
   * Set for a harness / widget record (HW-HARNESS.md §5). Such a row's `entityId` is `${recordKind}/${id}`, never the bare id: an
   * entryState has its entry's id, and the outbox is grouped and re-based by `entityId`. Absent = an entry, as before.
   */
  recordKind?: import('@/domain/records').RecordKind
  attempts: number
  lastError: string | null
  queuedAt: string
  /** Set when the server refused this change (D-27): the row stays, is skipped by the loop, and is shown with retry / discard. */
  rejectedAt?: string | null
}

/** One row per signed-in account: where the pull left off. */
export interface SyncMeta {
  userId: string
  cursor: number // highest server_version pulled
  lastPushAt: string | null
  lastPullAt: string | null
  /**
   * Set when a pull started again from 0 because the server went back in time (D-58), and cleared once the notes the server
   * lost were put back. Kept on disk because the sweep takes more than one request: an interruption must not forget it.
   */
  reconcile?: boolean
  /**
   * Which one-time re-pull this device has finished (`REPULL` in sync/engine.ts). An older build drops a record it cannot
   * validate and its cursor moves past it (G2: a `project` widget), so after updating it must pull from 0 once to get it.
   */
  repull?: number
}
