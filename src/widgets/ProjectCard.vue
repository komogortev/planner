<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { storedToken } from '@/auth/signIn'
import { IntegrationsError, projectState, type ProjectState, type SentIssue } from '@/integrations/github'
import IssueSheet from './IssueSheet.vue'
import CardMenu from './CardMenu.vue'
import { cardTint } from './tints'
import { setProjectActive, useWidgets } from './useWidgets'
import type { ProjectWidget } from './projects'
import { ageText, BRIEF_DEFAULT, briefBlocks, githubLink, snapshotBlocks } from './projectView'

// A project widget (docs/GITHUB-BRIDGE.md §6, G2): the repo's STATE snapshot and recent merges as GitHub holds them, read
// through the Worker with the user's own token. Read on mount and on Refresh only, never in the background. The last answer
// is kept on this device, so the card shows it offline with its age. How it looks is the repo's `.planner.json`.
// Folded by default (C1): the snapshot fields `.planner.json`'s `brief` names and the last merge; More opens the rest. The
// fold is remembered per card on this device.
// New issue (C2) opens the send sheet; the card lists the issues the planner sent, the newest one when folded.
// C4: the card wears the widget's tint; its ⋯ menu holds Refresh, Open on GitHub, Remove and the colour. Sections are told
// apart by label, divider and contrast tier (state → in flight → history), never by their own background.
const props = defineProps<{ project: ProjectWidget }>()
const online = useOnline()
const signedIn = storedToken() !== null
const cacheKey = computed(() => `planner.project.${props.project.id}`)
const { tintOf } = useWidgets()

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

const openKey = computed(() => `planner.project.${props.project.id}.open`)
function readOpen(): boolean {
  try { return localStorage.getItem(openKey.value) === '1' } catch { return false }
}
const open = ref(readOpen())
function toggle(): void {
  open.value = !open.value
  try { localStorage.setItem(openKey.value, open.value ? '1' : '0') } catch { /* stays for this visit */ }
}
const brief = computed(() => briefBlocks(blocks.value, state.value?.config.brief ?? BRIEF_DEFAULT))
const lastMerge = computed(() => merges.value[0] ?? null)

const issues = computed(() => (Array.isArray(state.value?.issues) ? state.value!.issues : []))
const issuesError = computed(() => (state.value?.issues && !Array.isArray(state.value.issues) ? state.value.issues.error : null))
/** The folded line's word for where a sent issue stands: its PR's state once there is one, else the issue's own. */
const issueStatus = (i: SentIssue) => (i.pr ? `PR ${i.pr.state}` : i.state === 'closed' ? 'closed' : day(i.createdAt))
/** The dot beside a sent issue: live while open, done once its PR merged, muted when closed. */
const issueTone = (i: SentIssue) => (i.pr?.state === 'merged' ? 'tone-done' : i.state === 'closed' ? 'tone-muted' : 'tone-live')
const sheetOpen = ref(false)
const newIssueBtn = ref<HTMLButtonElement | null>(null)
/** A sent issue joins the card at once; the next Refresh reads the list from GitHub again. */
function onSent(issue: SentIssue): void {
  if (!state.value) return
  const rest = issues.value.filter((i) => i.number !== issue.number)
  state.value = { ...state.value, issues: [issue, ...rest].slice(0, 5) }
  try { localStorage.setItem(cacheKey.value, JSON.stringify(state.value)) } catch { /* the card still shows it */ }
}

const repoLink = computed(() => githubLink(`https://github.com/${props.project.repo}`))
const openRepo = () => { if (repoLink.value) window.open(repoLink.value, '_blank', 'noopener,noreferrer') }
/** Off, never deleted (G2): the card leaves the Dashboard and its switch stays on the Widgets page. */
async function switchOff(): Promise<void> {
  const r = await setProjectActive(props.project.repo, props.project.private, false)
  if (!r.ok) error.value = r.error
}
</script>

<template>
  <section class="card project" v-bind="cardTint(tintOf(project.id))" :data-test="`project-card-${project.repo}`">
    <header class="head">
      <div class="min-w-0">
        <h3 class="font-semibold truncate">{{ title }}</h3>
        <p class="sub truncate">
          {{ project.repo }} · {{ project.private ? 'private' : 'public' }}<template v-if="loading"> · reading…</template><template v-else-if="state"> · {{ ageText(state.fetchedAt, now) }}</template>
        </p>
      </div>
      <!-- C4: one control in the header, like Today; Refresh lives in the menu with the card's other actions. -->
      <CardMenu :widget-id="project.id" :label="`${title} options`">
        <template #default="{ close }">
          <button type="button" :disabled="loading || !online || !signedIn" data-test="project-refresh" @click="close(); refresh()">
            {{ loading ? 'Reading…' : 'Refresh' }}
          </button>
          <button v-if="repoLink" type="button" data-test="project-open-github" @click="close(); openRepo()">Open on GitHub</button>
          <button type="button" data-test="project-switch-off" @click="close(); switchOff()">Remove from Dashboard</button>
        </template>
      </CardMenu>
    </header>

    <p v-if="error" class="text-sm text-err mt-2" role="alert" data-test="project-error">{{ error }}</p>
    <p v-if="!state && !error" class="sub mt-2">{{ !signedIn || !online ? 'Sign in and go online to read this project.' : 'Reading GitHub…' }}</p>
    <p v-if="state?.configError" class="text-xs text-warn mt-2" data-test="project-config-error">{{ state.configError }}</p>

    <!-- Folded (C1): one line per tier. State at full contrast, the newest sent issue with its status dot, the last merge dimmed. -->
    <div v-if="state && !open" class="mt-2 grid gap-1.5" data-test="project-brief">
      <p v-if="snapshotError" class="sub">{{ snapshotError }}</p>
      <p v-for="(f, i) in brief.fields" :key="i" class="field">
        <span v-if="f.label" class="lbl">{{ f.label }}</span>
        <template v-for="(s, j) in f.segments" :key="j"><strong v-if="s.bold">{{ s.text }}</strong><template v-else>{{ s.text }}</template></template>
      </p>
      <p v-if="blocks.length > 0 && brief.missing.length > 0" class="text-xs text-slate-500" data-test="project-brief-missing">
        No {{ brief.missing.join(', ') }} field in the snapshot.
      </p>
      <p v-if="issues[0]" class="row tier-active" data-test="project-last-issue">
        <span class="dot" :class="issueTone(issues[0])" aria-hidden="true" />
        <span class="min-w-0 truncate">Sent #{{ issues[0].number }} {{ issues[0].title }}</span>
        <span class="meta">{{ issueStatus(issues[0]) }}<template v-if="issues.length > 1"> · +{{ issues.length - 1 }}</template></span>
      </p>
      <p v-if="lastMerge" class="row tier-history" data-test="project-last-merge">
        <span class="min-w-0 truncate">Merged #{{ lastMerge.number }} {{ lastMerge.title }}</span>
        <span class="meta">{{ day(lastMerge.mergedAt) }}</span>
      </p>
    </div>

    <!-- Expanded: three sections in tier order (now → in flight → history), told apart by label, divider and contrast;
         no section has its own background, so the card stays one surface (owner, 2026-10-16). -->
    <template v-if="state && open">
      <section v-if="state.snapshot" class="sec" data-test="project-snapshot">
        <h4 class="sec-head">State</h4>
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
      </section>

      <section v-if="issues.length > 0 || issuesError" class="sec tier-active" data-test="project-issues">
        <h4 class="sec-head">Sent from the planner</h4>
        <p v-if="issuesError" class="sub">{{ issuesError }}</p>
        <ul v-else class="rows">
          <li v-for="i in issues" :key="i.number" class="sent" :data-test="`project-issue-${i.number}`">
            <div class="row">
              <span class="dot" :class="issueTone(i)" aria-hidden="true" />
              <a v-if="githubLink(i.url)" :href="githubLink(i.url)!" target="_blank" rel="noopener noreferrer" class="min-w-0 truncate">#{{ i.number }} {{ i.title }}</a>
              <span v-else class="min-w-0 truncate">#{{ i.number }} {{ i.title }}</span>
              <span class="meta">{{ i.state === 'closed' ? 'closed' : day(i.createdAt) }}</span>
            </div>
            <p v-if="i.bot" class="indent sub truncate" data-test="project-issue-bot">{{ i.bot }}</p>
            <p v-if="i.pr" class="indent sub" data-test="project-issue-pr">
              <a v-if="githubLink(i.pr.url)" :href="githubLink(i.pr.url)!" target="_blank" rel="noopener noreferrer">PR #{{ i.pr.number }}</a> {{ i.pr.state }}
            </p>
          </li>
        </ul>
      </section>

      <section v-if="state.merges" class="sec tier-history" data-test="project-merges">
        <h4 class="sec-head">Recently merged</h4>
        <p v-if="mergesError" class="sub">{{ mergesError }}</p>
        <p v-else-if="merges.length === 0" class="sub">Nothing merged yet.</p>
        <ul v-else class="rows">
          <li v-for="m in merges" :key="m.number" class="row">
            <a v-if="githubLink(m.url)" :href="githubLink(m.url)!" target="_blank" rel="noopener noreferrer" class="min-w-0 truncate">#{{ m.number }} {{ m.title }}</a>
            <span v-else class="min-w-0 truncate">#{{ m.number }} {{ m.title }}</span>
            <span class="meta">{{ day(m.mergedAt) }}</span>
          </li>
        </ul>
      </section>

      <p v-if="state.configSource === 'default'" class="text-xs text-slate-500 mt-3" data-test="project-default-config">
        Default layout: add a .planner.json to the repo to change it.
      </p>
    </template>

    <div v-if="state" class="foot">
      <button ref="newIssueBtn" class="toggle" :disabled="!signedIn" data-test="project-new-issue" @click="sheetOpen = true">＋ New issue</button>
      <button class="toggle" :aria-expanded="open" data-test="project-toggle" @click="toggle">
        {{ open ? 'Less ▴' : 'More ▾' }}
      </button>
    </div>
    <IssueSheet
      v-if="state" v-model:open="sheetOpen" :repo="project.repo" :is-private="project.private" :kinds="state.config.issues ?? []" :claude="state.claude ?? null"
      :trigger="newIssueBtn" @sent="onSent"
    />
  </section>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
.sub { font-size: 0.75rem; color: rgb(var(--s-400)); }
.field {
  font-size: 0.85rem; line-height: 1.35; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.lbl {
  font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgb(var(--s-400)); margin-right: 0.4rem;
}

/* Sections: a small-caps label and a hairline above each but the first. No backgrounds: one card, one surface. */
.sec { margin-top: 0.85rem; }
.sec + .sec { padding-top: 0.75rem; border-top: 1px solid var(--glass-btn-edge); }
.sec-head {
  font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: rgb(var(--s-400)); margin-bottom: 0.4rem;
}
.blocks { display: grid; gap: 0.35rem; font-size: 0.85rem; line-height: 1.35; overflow-wrap: anywhere; }
.blocks .item { padding-left: 0.9rem; position: relative; }
.blocks .item::before { content: '•'; position: absolute; left: 0; color: rgb(var(--s-400)); }

/* Rows: title left, a quiet meta right. */
.rows { display: grid; gap: 0.35rem; }
.row { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; font-size: 0.85rem; }
.row > .min-w-0 { flex: 1; }
.meta { flex-shrink: 0; font-size: 0.72rem; color: rgb(var(--s-400)); }
.sent { display: grid; gap: 0.1rem; min-width: 0; }
.indent { padding-left: 1rem; }

/* Tier: in flight. The status dot is the card's only colour: open = live, PR merged = done, closed = muted. */
.dot { flex-shrink: 0; width: 0.5rem; height: 0.5rem; border-radius: 999px; align-self: center; }
.tone-live { background: rgb(125 185 240); }
.tone-done { background: rgb(120 200 140); }
.tone-muted { background: rgb(var(--s-500)); }
.tier-active a { text-decoration: underline; text-underline-offset: 2px; }

/* Tier: history. Dimmer and smaller, links quiet until pointed at: it's the record, not the work. */
.tier-history { opacity: 0.72; }
.tier-history .row, .tier-history.row { font-size: 0.8rem; }
.tier-history a { text-decoration: none; }
.tier-history a:hover, .tier-history a:focus-visible { text-decoration: underline; text-underline-offset: 2px; }

.foot {
  display: grid; grid-template-columns: 1fr 1fr; margin-top: 0.75rem; margin-bottom: -0.5rem;
  border-top: 1px solid var(--glass-btn-edge);
}
.toggle { min-height: 2.75rem; font-size: 0.78rem; color: rgb(var(--s-400)); background: transparent; border: 0; }
.toggle + .toggle { border-left: 1px solid var(--glass-btn-edge); }
.toggle:disabled { opacity: 0.5; }
</style>
