<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { clearDeviceSafely, localCopy } from '@/auth/account'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { useSyncState } from '@/composables/useSyncState'
import { syncNow } from '@/sync'
import { downloadJson } from '@/utils/download'

// What the owner must know or do about sync. Provisional shape (D-13: the final warning design is a UI session):
// an icon and a sentence, shown only when something needs attention; a stuck connection is announced once per episode.
const STUCK_AFTER = 3
const state = useSyncState()
const router = useRouter()
const unsynced = useLiveQuery(() => db.outbox.count(), 0)
const dismissedStuck = ref(false)
const busy = ref(false)
const problem = ref<string | null>(null)

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

const copyName = () => `planner-device-copy-${new Date().toISOString().slice(0, 10)}.json`

async function saveCopy(): Promise<void> {
  downloadJson(copyName(), await localCopy())
}

/**
 * Clear this device's copy of an account that is gone (or that is not the signed-in one). The question names every note
 * (they may be the only copy) and a copy is saved first (D-55); `leave` also ends the sign-in.
 */
async function clearDevice(leave: boolean): Promise<void> {
  busy.value = true
  problem.value = null
  try {
    const out = await clearDeviceSafely(
      { confirm: (m) => window.confirm(m), saveCopy: (copy) => downloadJson(copyName(), copy) },
      { dropToken: leave },
    )
    if (out === 'changed') problem.value = 'A note arrived while the copy was made, so nothing was cleared. Try again.'
    if (out !== 'cleared') return
    if (leave) await router.push({ name: 'signin' })
    else syncNow(true)
  } catch (err) {
    // A copy that could not be made, or a clear that failed and was rolled back: the device is as it was.
    problem.value = `Nothing was cleared: ${err instanceof Error ? err.message : String(err)}`
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
      <span v-if="problem" class="problem" data-test="sync-problem"> {{ problem }}</span>
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
.problem { font-weight: 600; }
.actions { display: flex; gap: 0.4rem; flex: none; }
.act { border: 1px solid var(--glass-btn-edge); background: var(--glass-btn-bg); color: var(--glass-text); border-radius: 0.6rem; padding: 0.25rem 0.6rem; font-size: 0.75rem; }
.act:disabled { opacity: 0.5; }
</style>
