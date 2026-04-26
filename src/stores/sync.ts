import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import {
  GitHubError,
  getDataJson,
  putDataJson,
} from '@/db/github'
import {
  type Snapshot,
  type SnapshotCounts,
  SnapshotValidationError,
  buildSnapshot,
  parseSnapshot,
  serializeSnapshot,
  validateSnapshot,
} from '@/db/snapshot'
import { getDbStats } from '@/db/seed'
import { nowISO } from '@/utils/dates'
import { useSettingsStore } from './settings'

const SINGLETON_ID = 'singleton' as const
const APP_VERSION = '0.1.0' // diagnostic field in snapshot — not validated. Bump alongside package.json.

export interface PendingRestore {
  snapshot: Snapshot
  remoteCounts: SnapshotCounts
  localCounts: SnapshotCounts
  sha: string
}

export interface PendingConflict {
  remoteSnapshot: Snapshot
  remoteSha: string
  fetchedAt: string
}

/**
 * Sync store — owns L1 sync + restore state and orchestration.
 *
 * Single `inFlight` flag gates BOTH `syncNow` and `applyPendingRestore` (and
 * `fetchAndPrepareRestore`) so a user click can't race two writes against the
 * same Dexie tables.
 *
 * `dirty` flips true on any entity-table write (wired in `db/syncTracking.ts`
 * via Dexie hooks). It clears after a successful Sync or Restore — both leave
 * local state consistent with the remote sha.
 *
 * `pendingConflict` is set on 409 from PUT — the conflict modal in S4 reads it.
 */
export const useSyncStore = defineStore('sync', () => {
  const inFlight = ref(false)
  const syncError = ref<string | null>(null)
  const restoreError = ref<string | null>(null)
  const dirty = ref(false)
  const pendingRestore = ref<PendingRestore | null>(null)
  const pendingConflict = ref<PendingConflict | null>(null)

  // ------------------------------------------------------------------
  // Restore (moved from useSettingsStore in S3)
  // ------------------------------------------------------------------

  async function fetchAndPrepareRestore(): Promise<void> {
    const settings = useSettingsStore().settings
    if (!settings) {
      restoreError.value = 'Not connected. Connect to GitHub first.'
      return
    }
    inFlight.value = true
    restoreError.value = null
    pendingRestore.value = null
    try {
      const { rawText, sha } = await getDataJson(
        settings.pat,
        settings.owner,
        settings.repo,
      )
      const snapshot = parseSnapshot(rawText)
      validateSnapshot(snapshot)
      const localCounts = await getDbStats()
      pendingRestore.value = {
        snapshot,
        remoteCounts: snapshot.recordCounts,
        localCounts,
        sha,
      }
    } catch (err) {
      if (err instanceof GitHubError || err instanceof SnapshotValidationError) {
        restoreError.value = err.userMessage
      } else if (err instanceof Error) {
        restoreError.value = err.message
      } else {
        restoreError.value = 'Unexpected error preparing restore.'
      }
    } finally {
      inFlight.value = false
    }
  }

  async function applyPendingRestore(): Promise<void> {
    const pending = pendingRestore.value
    if (!pending) return
    if (!useSettingsStore().settings) {
      restoreError.value = 'Not connected. Connect to GitHub first.'
      pendingRestore.value = null
      return
    }
    inFlight.value = true
    restoreError.value = null
    try {
      const { snapshot, sha } = pending
      const syncedAt = nowISO()
      await db.transaction(
        'rw',
        db.commitments,
        db.payments,
        db.intentions,
        db.marketEntries,
        db.settings,
        async () => {
          await db.commitments.clear()
          await db.payments.clear()
          await db.intentions.clear()
          await db.marketEntries.clear()
          if (snapshot.commitments.length) await db.commitments.bulkAdd(snapshot.commitments)
          if (snapshot.payments.length) await db.payments.bulkAdd(snapshot.payments)
          if (snapshot.intentions.length) await db.intentions.bulkAdd(snapshot.intentions)
          if (snapshot.marketEntries.length) await db.marketEntries.bulkAdd(snapshot.marketEntries)
          await db.settings.update(SINGLETON_ID, {
            lastKnownSha: sha,
            lastSyncedAt: syncedAt,
          })
        },
      )
      pendingRestore.value = null
      // Local state now matches the remote sha — clear dirty + any stashed conflict.
      dirty.value = false
      pendingConflict.value = null
    } catch (err) {
      restoreError.value =
        err instanceof Error
          ? `Restore failed: ${err.message}`
          : 'Restore failed for an unknown reason.'
    } finally {
      inFlight.value = false
    }
  }

  function cancelPendingRestore(): void {
    pendingRestore.value = null
    restoreError.value = null
  }

  // ------------------------------------------------------------------
  // Sync (S3)
  // ------------------------------------------------------------------

  /**
   * Build a snapshot from local Dexie state and PUT it to data.json. On 200,
   * persist new sha + lastSyncedAt and clear dirty. On 409 (or 422), re-fetch
   * the latest remote and stash as `pendingConflict` for the S4 modal to pick
   * up; surface a basic inline error in the meantime.
   */
  async function syncNow(): Promise<void> {
    const settings = useSettingsStore().settings
    if (!settings) {
      syncError.value = 'Not connected. Connect to GitHub first.'
      return
    }
    inFlight.value = true
    syncError.value = null
    pendingConflict.value = null
    try {
      const snap = await buildSnapshot(settings.deviceId, APP_VERSION)
      const text = serializeSnapshot(snap)
      const message = `sync from ${settings.deviceId} @ ${snap.exportedAt}`
      const { sha: newSha } = await putDataJson(
        settings.pat,
        settings.owner,
        settings.repo,
        text,
        settings.lastKnownSha ?? undefined,
        message,
      )
      await db.settings.update(SINGLETON_ID, {
        lastKnownSha: newSha,
        lastSyncedAt: nowISO(),
      })
      dirty.value = false
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'conflict') {
        // Re-fetch to capture the latest remote for S4's resolver. If THIS
        // fetch fails, surface that error and leave pendingConflict null —
        // user retries Sync later.
        try {
          const { rawText, sha } = await getDataJson(
            settings.pat,
            settings.owner,
            settings.repo,
          )
          const remote = parseSnapshot(rawText)
          validateSnapshot(remote)
          pendingConflict.value = {
            remoteSnapshot: remote,
            remoteSha: sha,
            fetchedAt: nowISO(),
          }
          syncError.value = err.userMessage
        } catch (refetchErr) {
          if (refetchErr instanceof GitHubError || refetchErr instanceof SnapshotValidationError) {
            syncError.value = `Conflict, then refetch failed: ${refetchErr.userMessage}`
          } else {
            syncError.value =
              'Conflict, but failed to fetch remote for resolution. Retry sync.'
          }
        }
      } else if (err instanceof GitHubError) {
        syncError.value = err.userMessage
      } else if (err instanceof Error) {
        syncError.value = err.message
      } else {
        syncError.value = 'Unexpected error during sync.'
      }
    } finally {
      inFlight.value = false
    }
  }

  // ------------------------------------------------------------------
  // Dirty-bit + reset (called from db hooks and settings.disconnect)
  // ------------------------------------------------------------------

  function markDirty(): void {
    dirty.value = true
  }

  /** Called by `useSettingsStore.disconnect()` so a stale modal can't act on cleared credentials. */
  function reset(): void {
    inFlight.value = false
    syncError.value = null
    restoreError.value = null
    dirty.value = false
    pendingRestore.value = null
    pendingConflict.value = null
  }

  return {
    inFlight,
    syncError,
    restoreError,
    dirty,
    pendingRestore,
    pendingConflict,
    fetchAndPrepareRestore,
    applyPendingRestore,
    cancelPendingRestore,
    syncNow,
    markDirty,
    reset,
  }
})
