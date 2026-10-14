<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { deviceName, listSessions, seenLabel, SessionsError, signOutOthers, signOutSession, splitRecent, type SessionView } from './sessions'

// Settings → Signed-in devices (D-22, D-90): every device signed in to this account, this one first. A device you do not
// recognise can be signed out from here; it keeps what it captured and asks to sign in again (D-04). This device is
// signed out with Account → Sign out, which also clears it. Up front: this device and the others seen today; older
// sign-ins fold under one line (owner, 2026-10-14), and "Sign out all other devices" covers them without opening it.
const sessions = ref<SessionView[] | null>(null)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const notice = ref<string | null>(null)
const others = computed(() => (sessions.value ?? []).filter((s) => !s.current))
const split = computed(() => splitRecent(sessions.value ?? []))

// `keepError`: after an action, the reload must not wipe the action's own error (CodeReview).
async function load(keepError = false) {
  if (!keepError) error.value = null
  try {
    sessions.value = await listSessions()
  } catch (err) {
    error.value = err instanceof SessionsError ? err.message : String(err)
  }
}
onMounted(() => load())

async function run(key: string, fn: () => Promise<string>) {
  if (busy.value) return
  busy.value = key
  error.value = null
  notice.value = null
  try {
    notice.value = await fn()
  } catch (err) {
    error.value = err instanceof SessionsError ? err.message : String(err)
  } finally {
    await load(error.value !== null)
    busy.value = null // only after the reload: a row from the old list cannot be clicked in between
  }
}
const one = (s: SessionView) => run(s.id, async () => (await signOutSession(s.id), `${deviceName(s)} is signed out.`))
const all = () => run('others', async () => {
  const n = await signOutOthers()
  return n === 0 ? 'No other device was signed in.' : `${n} ${n === 1 ? 'device' : 'devices'} signed out.`
})
</script>

<template>
  <section class="card" data-test="sessions-card">
    <h3 class="font-semibold mb-1">Signed-in devices</h3>
    <p class="text-sm text-slate-300 mb-3">Sign out a device you do not recognise. It keeps what it captured and asks to sign in again.</p>
    <p v-if="sessions === null && !error" class="text-sm text-slate-400">checking…</p>
    <ul v-if="sessions" class="flex flex-col gap-2" data-test="sessions-list">
      <li v-for="s in split.recent" :key="s.id" class="row" :data-test="s.current ? 'session-current' : 'session-other'">
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ deviceName(s) }} <span v-if="s.current" class="sub">· this device</span></p>
          <p class="sub">Signed in {{ seenLabel(s.createdAt) }} · last seen {{ seenLabel(s.lastSeenAt) }}</p>
        </div>
        <button v-if="!s.current" type="button" class="btn-ghost btn-xs" :disabled="busy !== null" :aria-label="`Sign out ${deviceName(s)}`" data-test="session-sign-out" @click="one(s)">
          Sign out
        </button>
      </li>
    </ul>
    <details v-if="split.older.length" class="mt-2" data-test="sessions-older">
      <summary class="text-sm text-slate-300 cursor-pointer">{{ split.older.length }} older {{ split.older.length === 1 ? 'sign-in' : 'sign-ins' }}, not seen today</summary>
      <ul class="flex flex-col gap-2 mt-2">
        <li v-for="s in split.older" :key="s.id" class="row" data-test="session-other">
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ deviceName(s) }}</p>
            <p class="sub">Signed in {{ seenLabel(s.createdAt) }} · last seen {{ seenLabel(s.lastSeenAt) }}</p>
          </div>
          <button type="button" class="btn-ghost btn-xs" :disabled="busy !== null" :aria-label="`Sign out ${deviceName(s)}`" data-test="session-sign-out" @click="one(s)">
            Sign out
          </button>
        </li>
      </ul>
    </details>
    <button v-if="others.length > 1 || split.older.length" type="button" class="btn-ghost mt-3" :disabled="busy !== null" data-test="sessions-sign-out-others" @click="all">
      Sign out all other devices
    </button>
    <p v-if="notice" class="text-sm text-slate-300 mt-2" role="status" data-test="sessions-notice">{{ notice }}</p>
    <p v-if="error" class="text-sm text-err mt-2" role="alert" data-test="sessions-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.sub { font-size: 0.75rem; color: rgb(148 163 184); font-weight: 400; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; white-space: nowrap; flex: none; }
</style>
