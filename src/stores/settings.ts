import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from '@/db'
import type { AppSettings } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import {
  GitHubError,
  generateDeviceId,
  getDataJson,
  getRepo,
  getUser,
} from '@/db/github'
import {
  type Snapshot,
  type SnapshotCounts,
  SnapshotValidationError,
  parseSnapshot,
  validateSnapshot,
} from '@/db/snapshot'
import { getDbStats } from '@/db/seed'
import { nowISO } from '@/utils/dates'

const SINGLETON_ID = 'singleton' as const

export interface ConnectInput {
  pat: string
  owner: string
  repo: string
}

export interface PendingRestore {
  snapshot: Snapshot
  remoteCounts: SnapshotCounts
  localCounts: SnapshotCounts
  sha: string
}

/**
 * App settings — singleton row holding the L1 GitHub sync connection.
 *
 * `connect` validates the PAT against `/user`, then validates the repo via
 * `/repos/{owner}/{repo}` (refusing public repos), then persists. On failure,
 * throws a `GitHubError` with user-facing copy — caller renders.
 *
 * `fetchAndPrepareRestore` + `applyPendingRestore` implement S2 Restore.
 * Two-step so the UI can show a confirmation modal between fetch and apply.
 * Will be moved to a dedicated `useSyncStore` when S3 lands.
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = useLiveQuery<AppSettings | undefined>(
    () => db.settings.get(SINGLETON_ID),
    undefined,
  )

  const isConnected = computed(() => settings.value !== undefined)

  // --- Restore (S2) state ---
  const restoreInFlight = ref(false)
  const restoreError = ref<string | null>(null)
  const pendingRestore = ref<PendingRestore | null>(null)

  /**
   * Validate input against GitHub, then persist as the singleton row.
   * Throws `GitHubError` on failure (not caught here — caller renders).
   */
  async function connect(input: ConnectInput): Promise<void> {
    const pat = input.pat.trim()
    const owner = input.owner.trim()
    const repo = input.repo.trim()

    if (!pat || !owner || !repo) {
      throw new Error('PAT, owner, and repo are all required.')
    }

    // 1. Validate PAT
    const user = await getUser(pat)

    // 2. Validate repo (existence + private)
    await getRepo(pat, owner, repo)

    // 3. Persist
    const record: AppSettings = {
      id: SINGLETON_ID,
      pat,
      owner,
      repo,
      githubLogin: user.login,
      deviceId: settings.value?.deviceId ?? generateDeviceId(),
      lastKnownSha: null,
      lastSyncedAt: null,
    }
    await db.settings.put(record)
  }

  /**
   * Clear the settings row. Does not touch entity tables or remote `data.json`.
   * Also clears any pending Restore state so a stale modal can't apply against
   * cleared credentials.
   */
  async function disconnect(): Promise<void> {
    pendingRestore.value = null
    restoreError.value = null
    await db.settings.delete(SINGLETON_ID)
  }

  /**
   * Step 1 of Restore: fetch data.json, parse, validate, capture local counts,
   * and stage a `pendingRestore` for the modal to display. Errors are stored in
   * `restoreError` (not thrown) — caller renders inline.
   */
  async function fetchAndPrepareRestore(): Promise<void> {
    if (!settings.value) {
      restoreError.value = 'Not connected. Connect to GitHub first.'
      return
    }
    restoreInFlight.value = true
    restoreError.value = null
    pendingRestore.value = null
    try {
      const { rawText, sha } = await getDataJson(
        settings.value.pat,
        settings.value.owner,
        settings.value.repo,
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
      restoreInFlight.value = false
    }
  }

  /**
   * Step 2 of Restore: atomically replace all 4 entity tables with the staged
   * snapshot AND update `lastKnownSha` + `lastSyncedAt` in the same Dexie
   * transaction. On success, clears `pendingRestore`.
   */
  async function applyPendingRestore(): Promise<void> {
    const pending = pendingRestore.value
    if (!pending) return
    if (!settings.value) {
      restoreError.value = 'Not connected. Connect to GitHub first.'
      pendingRestore.value = null
      return
    }
    restoreInFlight.value = true
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
    } catch (err) {
      restoreError.value =
        err instanceof Error
          ? `Restore failed: ${err.message}`
          : 'Restore failed for an unknown reason.'
    } finally {
      restoreInFlight.value = false
    }
  }

  /** Discard a staged restore without touching the DB. */
  function cancelPendingRestore(): void {
    pendingRestore.value = null
    restoreError.value = null
  }

  return {
    settings,
    isConnected,
    connect,
    disconnect,
    // Restore (S2)
    restoreInFlight,
    restoreError,
    pendingRestore,
    fetchAndPrepareRestore,
    applyPendingRestore,
    cancelPendingRestore,
  }
})
