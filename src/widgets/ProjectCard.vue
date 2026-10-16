<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { storedToken } from '@/auth/signIn'
import { IntegrationsError, projectState, type ProjectState } from '@/integrations/github'
import type { ProjectWidget } from './projects'
import { ageText, githubLink, snapshotBlocks } from './projectView'

// A project widget (docs/GITHUB-BRIDGE.md §6, G2): the repo's STATE snapshot and recent merges as GitHub holds them, read
// through the Worker with the user's own token. Read on mount and on Refresh only, never in the background. The last answer
// is kept on this device, so the card shows it offline with its age. How it looks is the repo's `.planner.json`.
const props = defineProps<{ project: ProjectWidget }>()
const online = useOnline()
const signedIn = storedToken() !== null
const cacheKey = computed(() => `planner.project.${props.project.id}`)

function cached(): ProjectState | null {
  try {
    const raw = localStorage.getItem(cacheKey.value)
    const v = raw ? (JSON.parse(raw) as ProjectState) : null
    return v && v.repo === props.project.repo ? v : null
  } catch {
    return null
  }
}
const state = ref<ProjectState | null>(cached())
const error = ref<string | null>(null)
const loading = ref(false)
const now = ref(Date.now())

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    state.value = await projectState(props.project.repo)
    try { localStorage.setItem(cacheKey.value, JSON.stringify(state.value)) } catch { /* the card still shows it */ }
  } catch (err) {
    error.value = err instanceof IntegrationsError ? err.message : String(err)
  } finally {
    loading.value = false
    now.value = Date.now()
  }
}
onMounted(() => { if (signedIn && online.value) void refresh() })
watch(online, (on) => { if (on && signedIn && !state.value) void refresh() })

const title = computed(() => state.value?.config.title ?? props.project.repo.slice(props.project.repo.indexOf('/') + 1))
const blocks = computed(() => (state.value?.snapshot && 'text' in state.value.snapshot ? snapshotBlocks(state.value.snapshot.text) : []))
const snapshotError = computed(() => (state.value?.snapshot && 'error' in state.value.snapshot ? state.value.snapshot.error : null))
const merges = computed(() => (Array.isArray(state.value?.merges) ? state.value!.merges : []))
const mergesError = computed(() => (state.value?.merges && !Array.isArray(state.value.merges) ? state.value.merges.error : null))
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
</script>

<template>
  <section class="card project" :data-test="`project-card-${project.repo}`">
    <header class="head">
      <div class="min-w-0">
        <h3 class="font-semibold truncate">{{ title }}</h3>
        <p class="sub truncate">
          {{ project.repo }} · {{ project.private ? 'private' : 'public' }}<template v-if="state"> · {{ ageText(state.fetchedAt, now) }}</template>
        </p>
      </div>
      <button class="btn-ghost btn-sm shrink-0" :disabled="loading || !online || !signedIn" data-test="project-refresh" @click="refresh">
        {{ loading ? 'Reading…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="text-sm text-err mt-2" role="alert" data-test="project-error">{{ error }}</p>
    <p v-if="!state && !error" class="sub mt-2">{{ !signedIn || !online ? 'Sign in and go online to read this project.' : 'Reading GitHub…' }}</p>

    <template v-if="state">
      <p v-if="state.configError" class="text-xs text-warn mt-2" data-test="project-config-error">{{ state.configError }}</p>

      <div v-if="state.snapshot" class="mt-3" data-test="project-snapshot">
        <p v-if="snapshotError" class="sub">{{ snapshotError }}</p>
        <template v-else>
          <p v-if="state.snapshot && 'found' in state.snapshot && !state.snapshot.found" class="text-xs text-slate-500 mb-1">
            No SNAPSHOT heading in {{ state.snapshot.path }}: its first lines.
          </p>
          <ul class="blocks">
            <li v-for="(b, i) in blocks" :key="i" :class="b.kind">
              <template v-for="(s, j) in b.segments" :key="j"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
            </li>
          </ul>
        </template>
      </div>

      <div v-if="state.merges" class="mt-3" data-test="project-merges">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Recently merged</h4>
        <p v-if="mergesError" class="sub">{{ mergesError }}</p>
        <p v-else-if="merges.length === 0" class="sub">Nothing merged yet.</p>
        <ul v-else class="merges">
          <li v-for="m in merges" :key="m.number" class="merge">
            <a v-if="githubLink(m.url)" :href="githubLink(m.url)!" target="_blank" rel="noopener noreferrer" class="min-w-0 truncate">#{{ m.number }} {{ m.title }}</a>
            <span v-else class="min-w-0 truncate">#{{ m.number }} {{ m.title }}</span>
            <span class="sub shrink-0">{{ day(m.mergedAt) }}</span>
          </li>
        </ul>
      </div>

      <p v-if="state.configSource === 'default'" class="text-xs text-slate-500 mt-3" data-test="project-default-config">
        Default layout: add a .planner.json to the repo to change it.
      </p>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.sub { font-size: 0.75rem; color: rgb(var(--s-400)); }
.blocks { display: grid; gap: 0.35rem; font-size: 0.85rem; line-height: 1.35; overflow-wrap: anywhere; }
.blocks .item { padding-left: 0.9rem; position: relative; }
.blocks .item::before { content: '•'; position: absolute; left: 0; color: rgb(var(--s-400)); }
.merges { display: grid; gap: 0.3rem; font-size: 0.85rem; }
.merge { display: flex; justify-content: space-between; gap: 0.75rem; min-width: 0; }
.merge a { text-decoration: underline; text-underline-offset: 2px; }
.btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; background: transparent; border: 1px solid var(--glass-btn-edge); color: var(--glass-text); }
</style>
