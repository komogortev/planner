import { defineStore } from 'pinia'
import { computed } from 'vue'
import { db } from '@/db'
import type { AppSettings } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { generateDeviceId, getRepo, getUser } from '@/db/github'

const SINGLETON_ID = 'singleton' as const

export interface ConnectInput {
  pat: string
  owner: string
  repo: string
}

/**
 * App settings — singleton row holding the L1 GitHub sync connection.
 *
 * `connect` validates the PAT against `/user`, then validates the repo via
 * `/repos/{owner}/{repo}` (refusing public repos), then persists. On failure,
 * throws a `GitHubError` with user-facing copy — caller renders.
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = useLiveQuery<AppSettings | undefined>(
    () => db.settings.get(SINGLETON_ID),
    undefined,
  )

  const isConnected = computed(() => settings.value !== undefined)

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
   */
  async function disconnect(): Promise<void> {
    await db.settings.delete(SINGLETON_ID)
  }

  return {
    settings,
    isConnected,
    connect,
    disconnect,
  }
})
