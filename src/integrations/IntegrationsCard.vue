<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { storedToken } from '@/auth/signIn'
import { connectGithub, disconnectGithub, expiryText, getGithub, IntegrationsError, listRepos, NEW_TOKEN_URL, TOKEN_CHOICES, type GithubConnection, type RepoView } from './github'
import { setProjectActive, useWidgets } from '@/widgets/useWidgets'

// Settings → Integrations (docs/GITHUB-BRIDGE.md §4, G1). Connect a GitHub account with a fine-grained token. The token goes
// to the Worker once, on connect, and never comes back: the card shows the login, the last 4 characters and the expiry.
// G2: the repos the token reaches, each with a switch that makes it a project widget on the Dashboard (on every device).
// The list is read on demand (one GitHub call per tap), not on every visit to Settings.
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
// ── Projects (G2) ─────────────────────────────────────────────────────────────────────────────────────────────────
const { projects, loaded: widgetsLoaded } = useWidgets()
const repos = ref<RepoView[] | null>(null)
const reposError = ref<string | null>(null)
const reposBusy = ref(false)
const switching = ref<string | null>(null)
const isOn = (fullName: string) => projects.value.some((p) => p.active && p.repo.toLowerCase() === fullName.toLowerCase())
async function loadRepos(): Promise<void> {
  reposError.value = null
  reposBusy.value = true
  try {
    repos.value = await listRepos()
  } catch (err) {
    reposError.value = err instanceof IntegrationsError ? err.message : String(err)
  } finally {
    reposBusy.value = false
  }
}
async function toggleRepo(r: RepoView): Promise<void> {
  if (switching.value) return
  switching.value = r.fullName
  reposError.value = null
  try {
    const res = await setProjectActive(r.fullName, r.private, !isOn(r.fullName))
    if (!res.ok) reposError.value = `Could not save: ${res.error}`
  } catch (err) {
    reposError.value = `Could not save: ${String(err)}`
  } finally {
    switching.value = null
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

      <div v-if="connected" class="mt-4" data-test="github-projects">
        <h4 class="font-semibold text-sm mb-1">Projects</h4>
        <p class="text-xs text-slate-500 mb-2">
          A repo switched on shows on the Dashboard with its STATE snapshot and recent merges. A <code>.planner.json</code> in the repo
          sets how its card looks.
        </p>
        <button v-if="!repos" class="btn-ghost btn-sm" :disabled="reposBusy" data-test="github-load-repos" @click="loadRepos">
          {{ reposBusy ? 'Reading GitHub…' : 'Show my repos' }}
        </button>
        <p v-if="reposError" class="text-sm text-err mt-2" role="alert" data-test="github-repos-error">{{ reposError }}</p>
        <p v-if="repos && repos.length === 0" class="text-sm text-slate-400" data-test="github-repos-empty">
          This token reaches no repos. Edit it on GitHub to select some.
        </p>
        <ul v-if="repos && repos.length" class="repos" data-test="github-repos">
          <li v-for="r in repos" :key="r.fullName" class="repo">
            <span class="min-w-0 truncate text-sm">{{ r.fullName }} <span class="text-xs text-slate-500">{{ r.private ? 'private' : 'public' }}</span></span>
            <button
              type="button" role="switch" class="switch" :class="{ 'switch-on': isOn(r.fullName) }" :aria-checked="isOn(r.fullName)"
              :aria-label="`Show ${r.fullName} on the Dashboard`" :disabled="!widgetsLoaded || switching !== null"
              :data-test="`github-repo-${r.fullName}`" @click="toggleRepo(r)"
            ><span class="knob" /></button>
          </li>
        </ul>
      </div>

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
.repos { display: grid; gap: 0.5rem; }
/* The Widgets page switch (WidgetsView.vue), same look. */
.switch { flex: none; width: 2.75rem; height: 1.6rem; border-radius: 999px; background: var(--glass-sub); opacity: 0.55; position: relative; transition: background 0.15s, opacity 0.15s; }
.switch-on { background: #4f46e5; opacity: 1; /* indigo-600, as .btn-primary */ }
.switch:disabled { cursor: wait; }
.switch::before { content: ''; position: absolute; inset: -11px -2px; }
.knob { position: absolute; top: 0.2rem; left: 0.2rem; width: 1.2rem; height: 1.2rem; border-radius: 999px; background: #fff; transition: transform 0.15s; }
.switch-on .knob { transform: translateX(1.15rem); }
@media (prefers-reduced-motion: reduce) { .switch, .knob { transition: none; } }
.repo { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; min-width: 0; }
.row { min-width: 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
form input { min-width: 0; width: 100%; }
.btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; }
/* Outline only, as the model rows (owner, 2026-10-14). */
.row .btn-sm { background: transparent; border: 1px solid var(--glass-btn-edge); color: var(--glass-text); }
.row .btn-sm:hover, .row .btn-sm:active { background: color-mix(in srgb, var(--glass-text) 14%, transparent); }
</style>
