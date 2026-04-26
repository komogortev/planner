/**
 * Wire Dexie creating/updating/deleting hooks on the 4 entity tables to flip
 * `useSyncStore.dirty = true` on any local write. One-shot registration.
 *
 * Catches every write — user actions through Pinia stores AND programmatic
 * paths like `seed.ts:seedSampleData` and `seed.ts:clearAllData`. Restore
 * (which clears + bulkAdds) deliberately clears the dirty bit at the end of
 * `applyPendingRestore` because post-restore local state matches the remote sha.
 *
 * Settings table writes do NOT flip dirty — settings (PAT, sha, lastSyncedAt)
 * are not part of the sync payload.
 */

import { db } from './index'
import type { useSyncStore } from '@/stores/sync'

let installed = false

export function setupSyncDirtyTracking(
  syncStore: ReturnType<typeof useSyncStore>,
): void {
  // Idempotent — Vite HMR can re-execute this module; double-registering would
  // double-fire markDirty() per write (functionally harmless but wasteful).
  if (installed) return
  installed = true

  const tables = [
    db.commitments,
    db.payments,
    db.intentions,
    db.marketEntries,
  ] as const

  for (const table of tables) {
    table.hook('creating', () => {
      syncStore.markDirty()
    })
    table.hook('updating', () => {
      syncStore.markDirty()
    })
    table.hook('deleting', () => {
      syncStore.markDirty()
    })
  }
}
