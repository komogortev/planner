<script setup lang="ts">
// H1-S1 spike step 6: sign-in test screen. Reached only from Settings → "Sign-in test"; removed by S3.
import { onMounted, ref } from 'vue'
import {
  API_URL,
  displayMode,
  fetchMe,
  lastResult,
  signOutLocally,
  startSignIn,
  type Me,
} from '@/auth/signIn'

const mode = displayMode()
const result = lastResult()
const me = ref<Me | 'signed-out' | { error: string } | null>(null)

async function refresh(): Promise<void> {
  me.value = null
  me.value = await fetchMe()
}

function signOut(): void {
  signOutLocally()
  void refresh()
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 py-8 space-y-6">
    <header>
      <h2 class="text-2xl font-bold">Sign-in test</h2>
      <p class="text-sm text-slate-500 mt-1">H1-S1 spike — temporary screen.</p>
    </header>

    <section class="card space-y-4">
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Running as</dt>
          <dd class="mt-1" data-test="display-mode">
            {{ mode === 'standalone' ? 'Installed app' : 'Browser tab' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Status</dt>
          <dd class="mt-1 flex items-center gap-2" data-test="status">
            <template v-if="me === null">checking…</template>
            <template v-else-if="me === 'signed-out'">
              <span class="inline-block w-2 h-2 rounded-full bg-slate-500" />
              Signed out
            </template>
            <template v-else-if="'error' in me">
              <span class="inline-block w-2 h-2 rounded-full bg-rose-400" />
              API error: {{ me.error }}
            </template>
            <template v-else>
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              Signed in
            </template>
          </dd>
        </div>
        <div v-if="me && typeof me === 'object' && 'email' in me" class="col-span-2">
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Account</dt>
          <dd class="mt-1">{{ me.name ?? '—' }} · {{ me.email }}</dd>
        </div>
        <div class="col-span-2">
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Last sign-in return</dt>
          <dd class="mt-1" data-test="last-result">
            {{ result ? `${result.text} (${new Date(result.at).toLocaleString()})` : 'none on this device storage' }}
          </dd>
        </div>
        <div class="col-span-2">
          <dt class="text-xs text-slate-500 uppercase tracking-wider">API</dt>
          <dd class="mt-1 font-mono text-xs">{{ API_URL }}</dd>
        </div>
      </dl>

      <div class="border-t border-slate-800 pt-4 flex flex-wrap gap-2">
        <button class="btn-primary" @click="startSignIn('github')">Sign in with GitHub</button>
        <button class="btn-primary" @click="startSignIn('google')">Sign in with Google</button>
        <button class="btn-ghost" @click="refresh">Re-check</button>
        <button class="btn-danger" @click="signOut">Sign out</button>
      </div>
      <p class="text-xs text-slate-500">
        Sign out forgets the token on this device only; the server session expires on its own (30 days).
      </p>
    </section>
  </div>
</template>
