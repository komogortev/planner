<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import { useOnline } from '@/composables/useOnline'
import PreferencesCard from '@/components/PreferencesCard.vue'
import ModelsCard from '@/ai/ModelsCard.vue'
import SessionsCard from '@/auth/SessionsCard.vue'
import InstallButton from '@/components/InstallButton.vue'
import { APP_ENV } from '@/env/applyEnvCue'
import { BUILD, versionLabel } from '@/env/version'
import { checkForUpdate } from '@/env/checkUpdate'

const online = useOnline()

const router = useRouter()
const me = ref<AccountLine | null>(null)

// D-28: signing out clears this device's notes (D-50), so it is refused while some have not reached the server.
// App info → Check for updates: compares this build with the deployed one and, when newer, has the worker fetch it;
// autoUpdate reloads by itself once it is installed. "Reload now" is there in case it takes a while.
const updateBusy = ref(false)
const updateLine = ref<string | null>(null)
const updateFound = ref(false)
async function checkUpdates(): Promise<void> {
  updateBusy.value = true
  updateFound.value = false
  try {
    const r = await checkForUpdate()
    updateLine.value = r.kind === 'latest' ? `You have the latest version (${r.commit}).` : r.kind === 'updating' ? `Version ${r.commit} found. Updating: the app reloads by itself in a few seconds.` : r.reason
    updateFound.value = r.kind === 'updating'
  } finally {
    updateBusy.value = false
  }
}
const reloadNow = () => window.location.reload()

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
  void storageUsage().then((u) => { usage.value = u })
  // Runs at launch (D-55): a verdict from the server is only displayed here. Wiping is the owner's gesture alone, and
  // `launchCheck.test.ts` fails if anything destructive is called from this block. The sync banner (driven by the
  // engine's own verdict) offers "Sign in" or "Save a copy / Clear this device".
  me.value = await checkAccount()
})
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 pt-8 space-y-6">
    <header>
      <h2 class="text-2xl font-bold">Settings</h2>
      <p class="text-sm text-slate-300 mt-1">
        App info and account.
      </p>
    </header>

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
      <p v-if="signOutError" class="text-sm text-err mt-3" role="alert" data-test="sign-out-error">{{ signOutError }}</p>
      <p v-if="signOutBlocked !== null" class="text-sm text-warn mt-3" role="alert" data-test="sign-out-blocked">
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

    <SessionsCard />

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
              <div class="text-xs text-warn">{{ r.lastError }}</div>
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
      <p v-if="exportError" class="text-sm text-err mt-2" role="alert" data-test="export-error">{{ exportError }}</p>

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
        <p v-if="deleteError" class="text-sm text-err mt-2" role="alert" data-test="delete-error">{{ deleteError }}</p>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- App info                                                      -->
    <PreferencesCard />

    <ModelsCard />

    <!-- ============================================================ -->
    <section class="card">
      <h3 class="font-semibold mb-4">App info</h3>
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Version</dt>
          <dd class="mt-1">{{ versionLabel(BUILD, APP_ENV) }}</dd>
          <button type="button" class="btn-ghost text-xs mt-2" :disabled="updateBusy" data-test="check-updates" @click="checkUpdates">
            {{ updateBusy ? 'Checking…' : 'Check for updates' }}
          </button>
          <p v-if="updateLine" class="text-xs mt-1" role="status" data-test="check-updates-result">{{ updateLine }}</p>
          <button v-if="updateFound" type="button" class="link text-xs mt-1 underline" data-test="check-updates-reload" @click="reloadNow">Reload now</button>
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
          <dd class="mt-1">Planner API</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
