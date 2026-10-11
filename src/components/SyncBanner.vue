<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { localCopy, wipeAccountTables, unsyncedCount } from '@/auth/account'
import { signOutLocally } from '@/auth/signIn'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { useSyncState } from '@/composables/useSyncState'
import { syncEngine, syncNow } from '@/sync'

// What the owner must know or do about sync. Provisional shape (D-13: the final warning design is a UI session):
// an icon and a sentence, shown only when something needs attention; a stuck connection is announced once per episode.
const STUCK_AFTER = 3
const state = useSyncState()
const router = useRouter()
const unsynced = useLiveQuery(() => db.outbox.count(), 0)
const dismissedStuck = ref(false)
const busy = ref(false)

// A new stuck episode (after a good sync reset the count) may warn again.
watch(() => state.value.failures, (n) => { if (n === 0) dismissedStuck.value = false })

const kind = computed<'auth' | 'deleted' | 'foreign' | 'stuck' | null>(() => {
  const s = state.value
  if (s.phase === 'auth') return 'auth'
  if (s.phase === 'account-deleted') return 'deleted'
  if (s.phase === 'foreign-account') return 'foreign'
  if (s.phase === 'waiting' && s.failures >= STUCK_AFTER && !dismissedStuck.value) return 'stuck'
  return null
})

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function saveCopy(): Promise<void> {
  download(`planner-device-copy-${new Date().toISOString().slice(0, 10)}.json`, await localCopy())
}

/** Clear this device's copy of an account that is gone (or that is not the signed-in one). */
async function clearDevice(leave: boolean): Promise<void> {
  busy.value = true
  try {
    const lost = await unsyncedCount()
    if (lost > 0 && !window.confirm(`${lost} notes on this device never reached the server and will be lost. Clear anyway?`)) return
    await wipeAccountTables()
    syncEngine.reset()
    if (leave) {
      signOutLocally()
      await router.push({ name: 'signin' })
    } else {
      syncNow(true)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="kind" class="notice" role="alert" data-test="sync-banner" :data-kind="kind">
    <span class="icon" aria-hidden="true">⚠</span>
    <div class="text">
      <template v-if="kind === 'auth'">
        Signed out of the server.
        {{ unsynced > 0 ? `${unsynced} ${unsynced === 1 ? 'note is' : 'notes are'} kept on this device and will upload after you sign in.` : 'Sign in again to sync.' }}
      </template>
      <template v-else-if="kind === 'deleted'">
        This account was deleted from another device. Save a copy of what is on this device, then clear it.
      </template>
      <template v-else-if="kind === 'foreign'">
        This device holds another account's notes, so nothing is synced. Clear it to use this account here.
      </template>
      <template v-else>Can't reach the server. Your notes are safe on this device and will upload when it answers.</template>
    </div>
    <div class="actions">
      <button v-if="kind === 'auth'" class="act" data-test="sync-signin" @click="router.push({ name: 'signin' })">Sign in</button>
      <template v-else-if="kind === 'deleted'">
        <button class="act" data-test="sync-save-copy" @click="saveCopy">Save a copy</button>
        <button class="act" :disabled="busy" data-test="sync-clear" @click="clearDevice(true)">Clear this device</button>
      </template>
      <button v-else-if="kind === 'foreign'" class="act" :disabled="busy" data-test="sync-clear" @click="clearDevice(false)">Clear this device</button>
      <button v-else class="act" data-test="sync-dismiss" @click="dismissedStuck = true">Dismiss</button>
    </div>
  </div>
</template>

<style scoped>
.notice { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.9rem; font-size: 0.8rem;
  background: var(--glass-bg); color: var(--glass-text); border-bottom: 1px solid var(--glass-edge); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
.icon { font-size: 1rem; color: #e0a458; flex: none; }
.text { flex: 1; min-width: 0; }
.actions { display: flex; gap: 0.4rem; flex: none; }
.act { border: 1px solid var(--glass-btn-edge); background: var(--glass-btn-bg); color: var(--glass-text); border-radius: 0.6rem; padding: 0.25rem 0.6rem; font-size: 0.75rem; }
.act:disabled { opacity: 0.5; }
</style>
