<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { clearAllData, getDbStats, seedSampleData } from '@/db/seed'
import { useOnline } from '@/composables/useOnline'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { GitHubError } from '@/db/github'
import ConfirmRestoreModal from '@/components/ConfirmRestoreModal.vue'

const online = useOnline()
const settingsStore = useSettingsStore()
const syncStore = useSyncStore()

const stats = ref<{ commitments: number; payments: number; intentions: number; marketEntries: number }>(
  { commitments: 0, payments: 0, intentions: 0, marketEntries: 0 },
)

async function refreshStats(): Promise<void> {
  stats.value = await getDbStats()
}

async function doSeed(): Promise<void> {
  if (!confirm('Replace all current data with sample data?')) return
  await seedSampleData()
  await refreshStats()
}

async function doClear(): Promise<void> {
  if (!confirm('Permanently delete ALL planner data?')) return
  await clearAllData()
  await refreshStats()
}

onMounted(refreshStats)

// --------------------------------------------------------------------------
// L1 GitHub sync — Connect / Disconnect
// --------------------------------------------------------------------------

const form = reactive({
  pat: '',
  owner: '',
  repo: '',
})

const connecting = ref(false)
const connectError = ref<string | null>(null)
const connectErrorHint = ref<string | null>(null)

async function doConnect(): Promise<void> {
  connecting.value = true
  connectError.value = null
  connectErrorHint.value = null
  try {
    await settingsStore.connect(form)
    // Success — clear PAT from the form (it's persisted, no need to keep in memory)
    form.pat = ''
    form.owner = ''
    form.repo = ''
  } catch (err) {
    if (err instanceof GitHubError) {
      connectError.value = err.userMessage
      connectErrorHint.value = err.hint ?? null
    } else if (err instanceof Error) {
      connectError.value = err.message
    } else {
      connectError.value = 'Unexpected error during connect.'
    }
  } finally {
    connecting.value = false
  }
}

// --- Restore (S2) — routed through useSyncStore in S3 ---

async function onRestoreClick(): Promise<void> {
  await syncStore.fetchAndPrepareRestore()
}

async function onConfirmRestore(): Promise<void> {
  await syncStore.applyPendingRestore()
  // Refresh local stats panel — the entity tables just got rewritten.
  await refreshStats()
}

// --- Sync (S3) ---

async function onSyncClick(): Promise<void> {
  await syncStore.syncNow()
  // Defensive: refresh stats in case anything else changed during the round-trip.
  await refreshStats()
}

async function doDisconnect(): Promise<void> {
  if (
    !confirm(
      'Disconnect from GitHub? Your local data is not affected. ' +
        "The remote data.json is not touched. You'll need to re-paste your PAT to reconnect.",
    )
  ) {
    return
  }
  await settingsStore.disconnect()
}
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 py-8 space-y-6">
    <header>
      <h2 class="text-2xl font-bold">Settings</h2>
      <p class="text-sm text-slate-500 mt-1">
        App info, sync, and data tools.
      </p>
    </header>

    <!-- ============================================================ -->
    <!-- L1 GitHub sync                                                -->
    <!-- ============================================================ -->
    <section class="card">
      <h3 class="font-semibold mb-1">GitHub sync</h3>
      <p class="text-xs text-slate-500 mb-4">
        Sync your data to a private GitHub repo as a single
        <code class="text-slate-400">data.json</code> snapshot. See
        <a
          href="https://github.com/komogortev/planner/blob/main/apps/personal-planner/docs/L1-GITHUB.md"
          target="_blank"
          rel="noopener"
          class="text-indigo-400 hover:text-indigo-300 underline"
          >design doc</a
        >
        for details.
      </p>

      <!-- Connected -->
      <div v-if="settingsStore.isConnected && settingsStore.settings" class="space-y-4">
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Status</dt>
            <dd class="mt-1 flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              Connected
            </dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">GitHub user</dt>
            <dd class="mt-1">@{{ settingsStore.settings.githubLogin }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Data repo</dt>
            <dd class="mt-1 font-mono text-xs">
              {{ settingsStore.settings.owner }}/{{ settingsStore.settings.repo }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Device ID</dt>
            <dd class="mt-1 font-mono text-xs">{{ settingsStore.settings.deviceId }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Last synced</dt>
            <dd class="mt-1">
              {{
                settingsStore.settings.lastSyncedAt
                  ? new Date(settingsStore.settings.lastSyncedAt).toLocaleString()
                  : 'Never'
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Last known sha</dt>
            <dd class="mt-1 font-mono text-xs">
              {{
                settingsStore.settings.lastKnownSha
                  ? settingsStore.settings.lastKnownSha.slice(0, 7)
                  : '—'
              }}
            </dd>
          </div>
        </dl>

        <div class="border-t border-slate-800 pt-4 space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-xs text-slate-500">
              Sync writes a snapshot to GitHub. Restore replaces local data with the GitHub snapshot.
            </p>
            <span
              v-if="syncStore.dirty"
              class="text-xs text-amber-400 whitespace-nowrap"
              title="Local changes have not been synced to GitHub yet"
            >● Unsynced changes</span>
          </div>

          <div
            v-if="syncStore.syncError"
            class="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
          >
            {{ syncStore.syncError }}
            <p v-if="syncStore.pendingConflict" class="text-xs text-rose-300/70 mt-1">
              Conflict resolver UI lands in S4. Latest remote ({{ syncStore.pendingConflict.remoteSha.slice(0, 7) }}) has been fetched.
            </p>
          </div>

          <div
            v-if="syncStore.restoreError"
            class="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
          >
            {{ syncStore.restoreError }}
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="btn-primary"
              :disabled="syncStore.inFlight"
              @click="onSyncClick"
            >
              {{ syncStore.inFlight ? 'Working…' : 'Sync now' }}
            </button>
            <button
              class="btn-ghost"
              :disabled="syncStore.inFlight"
              @click="onRestoreClick"
            >
              {{ syncStore.inFlight && !syncStore.pendingRestore ? 'Fetching…' : 'Restore from GitHub' }}
            </button>
            <button class="btn-danger" @click="doDisconnect">Disconnect</button>
          </div>
        </div>
      </div>

      <!-- Not connected -->
      <form v-else class="space-y-4" @submit.prevent="doConnect">
        <div>
          <label class="label" for="pat">Personal Access Token</label>
          <input
            id="pat"
            v-model="form.pat"
            type="password"
            class="input font-mono text-xs"
            placeholder="github_pat_..."
            autocomplete="off"
            required
          />
          <p class="text-xs text-slate-500 mt-1">
            Fine-grained PAT, scoped to your data repo, with
            <code>Contents: read+write</code>. Stored locally in IndexedDB.
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="owner">Owner</label>
            <input
              id="owner"
              v-model="form.owner"
              type="text"
              class="input"
              placeholder="komogortev"
              autocomplete="off"
              required
            />
          </div>
          <div>
            <label class="label" for="repo">Repo</label>
            <input
              id="repo"
              v-model="form.repo"
              type="text"
              class="input"
              placeholder="planner-data"
              autocomplete="off"
              required
            />
          </div>
        </div>

        <div
          v-if="connectError"
          class="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
        >
          {{ connectError }}
          <p v-if="connectErrorHint" class="text-xs text-rose-300/70 mt-1">
            {{ connectErrorHint }}
          </p>
        </div>

        <div class="flex justify-end">
          <button type="submit" class="btn-primary" :disabled="connecting">
            {{ connecting ? 'Connecting…' : 'Connect' }}
          </button>
        </div>
      </form>
    </section>

    <!-- ============================================================ -->
    <!-- App info                                                      -->
    <!-- ============================================================ -->
    <section class="card">
      <h3 class="font-semibold mb-4">App info</h3>
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Version</dt>
          <dd class="mt-1">0.1.0</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Storage</dt>
          <dd class="mt-1">IndexedDB (local)</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Connection</dt>
          <dd class="mt-1">{{ online ? 'Online' : 'Offline' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Sync backend</dt>
          <dd class="mt-1">GitHub Contents API</dd>
        </div>
      </dl>
    </section>

    <!-- ============================================================ -->
    <!-- Database tools                                                -->
    <!-- ============================================================ -->
    <section class="card">
      <h3 class="font-semibold mb-4">Database</h3>
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-6">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Commitments</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.commitments }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Payments</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.payments }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Intentions</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.intentions }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Market entries</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.marketEntries }}</dd>
        </div>
      </dl>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost" @click="refreshStats">Refresh stats</button>
        <button class="btn-ghost" @click="doSeed">Load sample data</button>
        <button class="btn-danger" @click="doClear">Clear all data</button>
      </div>
    </section>

    <ConfirmRestoreModal
      v-if="syncStore.pendingRestore"
      :remote-counts="syncStore.pendingRestore.remoteCounts"
      :local-counts="syncStore.pendingRestore.localCounts"
      :last-synced-at="settingsStore.settings?.lastSyncedAt ?? null"
      :in-flight="syncStore.inFlight"
      @cancel="syncStore.cancelPendingRestore"
      @confirm="onConfirmRestore"
    />
  </div>
</template>
