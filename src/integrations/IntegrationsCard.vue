<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { storedToken } from '@/auth/signIn'
import { connectGithub, disconnectGithub, expiryText, getGithub, IntegrationsError, NEW_TOKEN_URL, TOKEN_CHOICES, type GithubConnection } from './github'

// Settings → Integrations (docs/GITHUB-BRIDGE.md §4, G1). Connect a GitHub account with a fine-grained token. The token goes
// to the Worker once, on connect, and never comes back: the card shows the login, the last 4 characters and the expiry.
// Projects (G2) read through this connection; this card only holds it.
const online = useOnline()
const signedIn = storedToken() !== null // signing in or out leaves Settings, so read once
const conn = ref<GithubConnection | null>(null)
const loaded = ref(false)
const error = ref<string | null>(null)
const token = ref('')
const busy = ref(false)
const removing = ref(false) // armed "Remove?" tap

async function refresh(): Promise<void> {
  error.value = null
  try {
    conn.value = await getGithub()
  } catch (err) {
    error.value = err instanceof IntegrationsError ? err.message : String(err)
  } finally {
    loaded.value = true
  }
}
onMounted(() => { if (signedIn && online.value) void refresh() })
watch(online, (now) => { if (now && signedIn && !loaded.value) void refresh() })

const connected = computed(() => (conn.value?.connected ? conn.value : null))
const expiry = computed(() => (connected.value ? expiryText(connected.value.expiresAt, Date.now()) : null))

async function connect(): Promise<void> {
  error.value = null
  busy.value = true
  try {
    conn.value = await connectGithub(token.value.trim())
    token.value = '' // never kept in the page longer than the connect
  } catch (err) {
    error.value = err instanceof IntegrationsError ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
async function remove(): Promise<void> {
  if (!removing.value) { removing.value = true; return }
  removing.value = false
  try {
    await disconnectGithub()
    await refresh()
  } catch (err) {
    error.value = err instanceof IntegrationsError ? err.message : String(err)
  }
}
</script>

<template>
  <section class="card" data-test="integrations-card">
    <h3 class="font-semibold mb-1">Integrations</h3>
    <p class="text-xs text-slate-500 mb-3">
      Connect GitHub to see your projects' state here and send them tasks. The token is stored encrypted and never shown again.
    </p>

    <p v-if="!signedIn || !online" class="text-sm text-slate-400" data-test="integrations-offline">Sign in and go online to manage integrations.</p>
    <template v-else>
      <p v-if="error" class="text-sm text-err mb-2" role="alert" data-test="integrations-error">{{ error }}</p>

      <div v-if="connected" class="row" data-test="github-connected">
        <div class="min-w-0">
          <p class="text-sm font-semibold truncate">GitHub · {{ connected.login }}</p>
          <p class="text-xs text-slate-400">
            token …{{ connected.keyHint }} ·
            <span :class="{ 'text-warn': expiry?.warn }" data-test="github-expiry">{{ expiry?.text }}</span>
          </p>
        </div>
        <button class="btn-ghost btn-sm shrink-0" data-test="github-remove" @click="remove">{{ removing ? 'Remove?' : 'Remove' }}</button>
      </div>
      <p v-else-if="loaded" class="text-sm text-slate-400" data-test="github-none">GitHub is not connected.</p>

      <details class="mt-4 min-w-0" :open="loaded && !connected" data-test="github-connect">
        <summary class="text-sm font-semibold cursor-pointer">{{ connected ? 'Replace the token' : 'Connect GitHub' }}</summary>
        <div class="mt-3 grid gap-2 min-w-0">
          <a class="text-sm underline" :href="NEW_TOKEN_URL" target="_blank" rel="noopener noreferrer" data-test="github-new-token">Create a fine-grained token on GitHub</a>
          <ul class="text-xs text-slate-400 list-disc pl-4" data-test="github-token-choices">
            <li v-for="c in TOKEN_CHOICES" :key="c">{{ c }}</li>
          </ul>
          <form class="grid gap-2 min-w-0" autocomplete="off" @submit.prevent="connect">
            <label class="label" for="gh-token">Token</label>
            <input
              id="gh-token" v-model="token" class="input" type="password" required autocomplete="off" spellcheck="false"
              autocapitalize="off" placeholder="github_pat_…" data-test="github-token"
            />
            <button class="btn-primary justify-self-start" type="submit" :disabled="busy || !token.trim()" data-test="github-save">{{ busy ? 'Checking…' : 'Connect' }}</button>
          </form>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped>
.row { min-width: 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
form input { min-width: 0; width: 100%; }
.btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; }
/* Outline only, as the model rows (owner, 2026-10-14). */
.row .btn-sm { background: transparent; border: 1px solid var(--glass-btn-edge); color: var(--glass-text); }
.row .btn-sm:hover, .row .btn-sm:active { background: color-mix(in srgb, var(--glass-text) 14%, transparent); }
</style>
