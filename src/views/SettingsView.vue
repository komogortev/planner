<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AccountError, deleteMyAccount, exportAccount, signOutSafely, unsyncedCount } from '@/auth/account'
import { checkAccount, type AccountLine } from '@/auth/launchCheck'
import { storedToken } from '@/auth/signIn'
import { downloadJson } from '@/utils/download'
import { db } from '@/db'
import type { OutboxRow } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { useSyncState } from '@/composables/useSyncState'
import { storageUsage, syncEngine, syncNow, type StorageUsage } from '@/sync'
import { getDbStats } from '@/db/seed'
import { useOnline } from '@/composables/useOnline'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'
import { GitHubError } from '@/db/github'
import type { SnapshotCounts } from '@/db/snapshot'
import { setThemeChoice, themeChoice, type ThemeChoice } from '@/theme/theme'
import InstallButton from '@/components/InstallButton.vue'
import ConfirmRestoreModal from '@/components/ConfirmRestoreModal.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import { APP_ENV } from '@/env/applyEnvCue'
import { BUILD, versionLabel } from '@/env/version'

const online = useOnline()
const settingsStore = useSettingsStore()
const syncStore = useSyncStore()

const stats = ref<SnapshotCounts>({
  commitments: 0,
  payments: 0,
  intentions: 0,
  marketEntries: 0,
  categories: 0,
  themes: 0,
  themeMembers: 0,
})

async function refreshStats(): Promise<void> {
  stats.value = await getDbStats()
}

const router = useRouter()
const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
const me = ref<AccountLine | null>(null)

// D-28: signing out clears this device's notes (D-50), so it is refused while some have not reached the server.
const signOutBlocked = ref<number | null>(null)
const signOutDraft = ref(false) // an unsent draft in the capture box stands in the way too (D-56)
const signOutError = ref<string | null>(null)
async function signOut(): Promise<void> {
  signOutError.value = null
  try {
    const r = await signOutSafely()
    if (!r.ok) {
      signOutBlocked.value = r.unsynced
      signOutDraft.value = r.draft === true
      return
    }
    void router.push({ name: 'signin' })
  } catch (err) {
    // The clear failed and was rolled back (device and token as they were): say so instead of an unhandled rejection.
    signOutError.value = `Could not sign out: ${err instanceof Error ? err.message : String(err)}`
  }
}

// Sync status (S3): what the loop is doing, what stands in its way, and what the owner can do about a rejected note (D-27).
const sync = useSyncState()
const unsyncedNow = useLiveQuery(() => db.outbox.count(), 0)
const rejected = useLiveQuery(() => db.outbox.toArray().then((rows) => rows.filter((r) => r.rejectedAt)), [] as OutboxRow[])
/** What a refused row is called in the list: the text a Discard would delete, prefixed by its kind for a harness record. */
const rejectedLabel = (r: OutboxRow): string => {
  const p = r.payload as Record<string, unknown>
  // Discarding deletes the text, so the row shows the text it would delete: a note's body, else an answer, a question, a name.
  const text = [p.body, p.answer, p.text, p.name].find((v): v is string => typeof v === 'string' && v !== '')
  return r.recordKind ? `${r.recordKind}: ${(text ?? '').slice(0, 80)}` : (text ?? '').slice(0, 80)
}
const usage = ref<StorageUsage | null>(null)
const phaseText = computed(() => {
  switch (sync.value.phase) {
    case 'syncing': return sync.value.initialPull ? `Fetching your notes… ${sync.value.pulled}` : 'Syncing…'
    case 'offline': return 'Offline — notes upload when you are back.'
    case 'waiting': return sync.value.retryAt ? `Will retry at ${new Date(sync.value.retryAt).toLocaleTimeString()}${sync.value.lastError ? ` (${sync.value.lastError})` : ''}.` : 'Will retry.'
    case 'auth': return 'Signed out of the server — sign in again.'
    case 'account-deleted': return 'This account was deleted.'
    case 'foreign-account': return 'This device holds another account’s notes.'
    default: return sync.value.lastSyncedAt ? `Up to date · last synced ${new Date(sync.value.lastSyncedAt).toLocaleTimeString()}` : 'Not synced yet.'
  }
})
const mb = (n: number | null) => (n === null ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`)

// Data rights (S2b): export everything the server holds for this account, or delete the account and this device's copy.
const accountEmail = computed(() => (me.value && 'email' in me.value ? me.value.email : null))
const exporting = ref(false)
const exportError = ref<string | null>(null)
const exportedAt = ref<string | null>(null)
const deleteOpen = ref(false)
const deleteConfirm = ref('')
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const unsynced = ref(0)

async function exportMyData(): Promise<void> {
  const token = storedToken()
  // Not a sign-out gesture (D-55): with the token gone (another tab signed out) there is nothing to export — say so.
  if (!token) { exportError.value = 'Signed out — sign in again to export.'; return }
  exporting.value = true
  exportError.value = null
  try {
    const data = await exportAccount(token)
    downloadJson(`planner-export-${new Date().toISOString().slice(0, 10)}.json`, data)
    exportedAt.value = new Date().toLocaleTimeString()
  } catch (err) {
    exportError.value = err instanceof AccountError && err.status === 401 ? 'Signed out — sign in again to export.' : err instanceof Error ? err.message : String(err)
  } finally {
    exporting.value = false
  }
}

async function openDelete(): Promise<void> {
  unsynced.value = await unsyncedCount()
  deleteConfirm.value = ''
  deleteError.value = null
  deleteOpen.value = true
}

async function deleteMyData(): Promise<void> {
  deleting.value = true
  deleteError.value = null
  try {
    await deleteMyAccount(deleteConfirm.value)
    void router.push({ name: 'signin' })
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : String(err)
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  void refreshStats()
  void storageUsage().then((u) => { usage.value = u })
  // Runs at launch (D-55): a verdict from the server is only displayed here. Wiping is the owner's gesture alone, and
  // `launchCheck.test.ts` fails if anything destructive is called from this block. The sync banner (driven by the
  // engine's own verdict) offers "Sign in" or "Save a copy / Clear this device".
  me.value = await checkAccount()
})

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

async function onPullRemote(): Promise<void> {
  await syncStore.pullFromConflict()
  // pendingRestore is now set — ConfirmRestoreModal will open.
}

async function onOverwriteRemote(): Promise<void> {
  await syncStore.overwriteFromConflict()
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
        App info and account.
      </p>
    </header>

    <details class="card">
      <summary class="font-semibold cursor-pointer">Legacy export (GitHub)</summary>
      <div class="mt-3">
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
            v-if="syncStore.syncError && !syncStore.pendingConflict"
            class="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
          >
            {{ syncStore.syncError }}
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
      </div>
    </details>

    <section class="card">
      <h3 class="font-semibold mb-3">Account</h3>
      <p class="text-sm text-slate-300 mb-4" data-test="account">
        <template v-if="me === null">checking…</template>
        <template v-else-if="typeof me === 'object' && 'email' in me">{{ me.name ?? '—' }} · {{ me.email }}</template>
        <template v-else-if="typeof me === 'object'">Account unavailable ({{ me.error }})</template>
      </p>
      <div class="flex flex-wrap gap-2 items-center">
        <button class="btn-danger" data-test="sign-out" @click="signOut">Sign out</button>
        <InstallButton />
      </div>
      <p v-if="signOutError" class="text-sm text-rose-300 mt-3" role="alert" data-test="sign-out-error">{{ signOutError }}</p>
      <p v-if="signOutBlocked !== null" class="text-sm text-amber-300 mt-3" role="alert" data-test="sign-out-blocked">
        <template v-if="signOutBlocked > 0">
          {{ signOutBlocked }} {{ signOutBlocked === 1 ? 'note has' : 'notes have' }} not reached the server. Signing out clears this
          device, so they would be lost. Let them sync first{{ rejected.length ? ', or retry or discard the refused ones below' : '' }}.
        </template>
        <template v-if="signOutDraft">
          {{ signOutBlocked > 0 ? 'There is also an' : 'There is an' }} unsent draft in the capture box. Signing out clears this device, so
          capture it, or empty the box, first.
        </template>
      </p>
    </section>

    <section class="card" data-test="sync-card">
      <h3 class="font-semibold mb-3">Sync</h3>
      <p class="text-sm text-slate-300" data-test="sync-status">{{ phaseText }}</p>
      <p class="text-xs text-slate-400 mt-1" data-test="sync-unsynced">{{ unsyncedNow }} not on the server yet</p>
      <div class="flex flex-wrap gap-2 items-center mt-3">
        <button class="btn-ghost" data-test="sync-now" :disabled="!online || sync.phase === 'syncing'" @click="syncNow(true)">Sync now</button>
      </div>
      <div v-if="rejected.length" class="mt-4 border-t border-slate-700 pt-3" data-test="rejected-list">
        <p class="text-sm mb-2">The server refused {{ rejected.length === 1 ? 'this note' : 'these notes' }}; everything else was sent.</p>
        <ul class="text-sm space-y-2">
          <li v-for="r in rejected" :key="r.seq" class="flex items-start gap-2" data-test="rejected-row">
            <div class="flex-1 min-w-0">
              <div class="truncate">{{ rejectedLabel(r) }}</div>
              <div class="text-xs text-amber-300">{{ r.lastError }}</div>
            </div>
            <button class="btn-ghost" data-test="rejected-discard" @click="syncEngine.discardRejected([r.seq!])">Discard</button>
          </li>
        </ul>
        <button class="btn-ghost mt-2" data-test="rejected-retry" @click="syncEngine.retryRejected().then(() => syncNow(true))">Retry all</button>
      </div>
      <p class="text-xs text-slate-400 mt-4" data-test="storage">
        Storage on this device: {{ mb(usage?.usedBytes ?? null) }} of {{ mb(usage?.quotaBytes ?? null) }}
        <template v-if="usage?.persisted !== null && usage?.persisted !== undefined">
          · {{ usage.persisted ? 'protected from automatic clean-up' : 'the browser may clear it under storage pressure' }}
        </template>
      </p>
    </section>

    <section class="card" data-test="your-data">
      <h3 class="font-semibold mb-3">Your data</h3>
      <p class="text-sm text-slate-300 mb-4">
        Export downloads everything the server holds for this account as one file, including notes you deleted and earlier
        versions of edited ones. Deleting the account removes all of it from the server at once.
      </p>
      <div class="flex flex-wrap gap-2 items-center">
        <button class="btn-ghost" data-test="export" :disabled="exporting || !online" @click="exportMyData">
          {{ exporting ? 'Exporting…' : 'Export my data' }}
        </button>
        <button class="btn-danger" data-test="delete-open" :disabled="!online || accountEmail === null" @click="openDelete">
          Delete my account…
        </button>
      </div>
      <p v-if="!online" class="text-xs text-slate-400 mt-2">Both need a connection.</p>
      <p v-if="exportedAt" class="text-xs text-slate-400 mt-2" data-test="export-done">Exported at {{ exportedAt }}.</p>
      <p v-if="exportError" class="text-sm text-red-400 mt-2" role="alert" data-test="export-error">{{ exportError }}</p>

      <div v-if="deleteOpen" class="mt-4 border-t border-slate-700 pt-4" data-test="delete-panel">
        <p class="text-sm mb-2">
          This cannot be undone. Your notes, their earlier versions and your sign-in are removed from the server, and this
          device is cleared. Export first if you want a copy.
          <strong v-if="unsynced > 0" data-test="delete-unsynced">
            {{ unsynced }} {{ unsynced === 1 ? 'note has' : 'notes have' }} not reached the server and will be lost.
          </strong>
        </p>
        <label class="block text-sm mb-2">
          Type your email, <span class="font-mono">{{ accountEmail }}</span>, to confirm
          <input v-model="deleteConfirm" class="input mt-1 w-full" data-test="delete-confirm" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </label>
        <div class="flex gap-2">
          <button
            class="btn-danger"
            data-test="delete-go"
            :disabled="deleting || !online || deleteConfirm.trim().toLowerCase() !== (accountEmail ?? '').toLowerCase()"
            @click="deleteMyData"
          >
            {{ deleting ? 'Deleting…' : 'Delete everything' }}
          </button>
          <button class="btn-ghost" :disabled="deleting" @click="deleteOpen = false">Cancel</button>
        </div>
        <p v-if="deleteError" class="text-sm text-red-400 mt-2" role="alert" data-test="delete-error">{{ deleteError }}</p>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- App info                                                      -->
    <section class="card">
      <h3 class="font-semibold mb-3">Appearance</h3>
      <div class="theme-choice" role="radiogroup" aria-label="Theme">
        <button
          v-for="o in themeOptions"
          :key="o.value"
          role="radio"
          :aria-checked="themeChoice === o.value"
          class="theme-opt"
          :class="{ 'theme-opt-on': themeChoice === o.value }"
          :data-test="`theme-${o.value}`"
          @click="setThemeChoice(o.value)"
        >
          {{ o.label }}
        </button>
      </div>
    </section>

    <!-- ============================================================ -->
    <section class="card">
      <h3 class="font-semibold mb-4">App info</h3>
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Version</dt>
          <dd class="mt-1">{{ versionLabel(BUILD, APP_ENV) }}</dd>
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

    <ConfirmRestoreModal
      v-if="syncStore.pendingRestore"
      :remote-counts="syncStore.pendingRestore.remoteCounts"
      :local-counts="syncStore.pendingRestore.localCounts"
      :last-synced-at="settingsStore.settings?.lastSyncedAt ?? null"
      :in-flight="syncStore.inFlight"
      @cancel="syncStore.cancelPendingRestore"
      @confirm="onConfirmRestore"
    />

    <ConflictModal
      v-if="syncStore.pendingConflict"
      :conflict="syncStore.pendingConflict"
      :local-counts="stats"
      :last-synced-at="settingsStore.settings?.lastSyncedAt ?? null"
      :in-flight="syncStore.inFlight"
      @cancel="syncStore.dismissConflict"
      @pull-remote="onPullRemote"
      @overwrite-remote="onOverwriteRemote"
    />
  </div>
</template>

<style scoped>
.theme-choice {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: rgb(var(--s-800));
}
.theme-opt {
  flex: 1;
  padding: 8px 0;
  border-radius: 9px;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--s-400));
}
.theme-opt-on {
  background: rgb(var(--s-950));
  color: rgb(var(--s-100));
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}
</style>
