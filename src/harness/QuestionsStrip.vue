<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { syncSoon } from '@/sync'
import { applyHarnessReply2, pendingHarness2, startHarness2 } from './loop2'
import { runSummary2 } from './queue2'
import RunStep, { type Check } from './RunStep.vue'
import StripItemView from './StripItemView.vue'
import type { Loop2 } from './useLoop2'

// The questions strip (HW-HARNESS §11 Dashboard v2, D-70): one question or proposal at a time, under the Task it isolates;
// the list view shows them all. "Get feedback" is the harness run (copy-prompt, D-63): new notes and the Tasks changed since
// their last run ("N changes waiting for feedback", D-72 until an automatic run exists).
//
// Docked under the Dashboard's scrolling cards (owner, calibration 2026-10-12): a suggestion to start a context round,
// never a demand on the eye. Fixed below the cards' scroll box, like a pager under a list: it never scrolls and never
// covers a card at rest. Shown only when there is something to act on — questions in the queue, changes waiting for a
// run (the only way to start the first run, which is what creates questions), or a run in progress. Three states:
// `line` — one line, Questions · count · Get feedback; `open` (tap the line) — the waiting count and the current
// question; `work` (Get feedback) — the run as well, the strip growing upwards (capped; it scrolls inside). A run waiting
// for its reply opens in `work`, so the paste box is there when the owner comes back.
const props = defineProps<{ loop: Loop2 }>()
const items = computed(() => props.loop.items.value)
// The current item is followed by id, not position: a sync or a tap elsewhere reorders the queue, and the owner may be
// half-way through typing an answer. When it leaves (answered here or elsewhere), the item now at its place is next.
const currentId = ref<string | null>(null)
let lastIndex = 0
watch(
  items,
  (list) => {
    const at = list.findIndex((i) => i.id === currentId.value)
    if (at >= 0) lastIndex = at
    else currentId.value = list.length ? list[Math.min(lastIndex, list.length - 1)]!.id : null
  },
  { immediate: true },
)
const index = computed(() => Math.max(0, items.value.findIndex((i) => i.id === currentId.value)))
// With no current id (a store that changed no table, so `items` did not move), the first item shows: never "No open
// questions" over a non-empty count.
const current = computed(() => items.value.find((i) => i.id === currentId.value) ?? items.value[0] ?? null)
const expanded = ref(false)
const waiting = ref(pendingHarness2() !== null)
type Mode = 'line' | 'open' | 'work'
const mode = ref<Mode>(waiting.value ? 'work' : 'line')
const onLine = () => (mode.value = mode.value === 'line' ? 'open' : 'line')
const onFeedback = () => (mode.value = mode.value === 'work' ? 'open' : 'work')
const visible = computed(() => items.value.length > 0 || changes.value > 0 || waiting.value || mode.value === 'work')
const changes = computed(() => props.loop.work.value.notes + props.loop.work.value.tasks)
// One kind: say it once ("3 new notes waiting for feedback"); both: the total, then the parts.
const changesLine = computed(() => {
  const { notes, tasks } = props.loop.work.value
  const parts = [notes ? `${notes} new note${notes === 1 ? '' : 's'}` : '', tasks ? `${tasks} changed task${tasks === 1 ? '' : 's'}` : ''].filter(Boolean)
  if (parts.length < 2) return `${parts[0] ?? ''} waiting for feedback`
  return `${changes.value} changes waiting for feedback: ${parts.join(' · ')}`
})

const next = () => {
  if (!items.value.length) return
  const to = (index.value + 1) % items.value.length
  lastIndex = to
  currentId.value = items.value[to]!.id
}

async function compose() {
  const out = await startHarness2()
  waiting.value = out !== null
  if (!out) return null
  const tasks = out.header.reevaluateIds.length
  const extra = [tasks ? `${tasks} changed task${tasks === 1 ? '' : 's'} go with them.` : '', out.header.remaining > 0 ? `${out.header.remaining} more notes wait for the next run.` : '']
  return { prompt: out.prompt, notes: out.header.toAssessIds.length + out.header.contextIds.length, note: extra.filter(Boolean).join(' ') || undefined }
}
async function check(reply: string): Promise<Check> {
  const r = await applyHarnessReply2(reply, { store: false })
  return r.ok ? { ok: true, lines: runSummary2(r.value.applied, r.value.header) } : r
}
async function store(reply: string) {
  const r = await applyHarnessReply2(reply, { store: true })
  if (!r.ok) return r
  waiting.value = false
  lastIndex = 0
  currentId.value = items.value[0]?.id ?? null // the new run's items lead (the watch moves it again when they land)
  syncSoon()
  const a = r.value.applied
  if (a.assessments.length === 0) return { ok: true as const, message: 'Nothing new was stored (a replay, or every row was dropped).' }
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return { ok: true as const, message: `Stored: ${n(a.tasks.length, 'task')} touched, ${n(a.questions.length, 'question')}, ${n(a.proposals.length, 'proposal')}.` }
}
</script>

<template>
  <section v-if="visible" class="card strip" :class="`strip-${mode}`" data-test="questions-strip" :data-mode="mode" aria-label="Questions">
    <header class="line" data-test="strip-line" @click="onLine">
      <button type="button" class="title" :aria-expanded="mode !== 'line'" data-test="strip-toggle">
        Questions <span class="count" data-test="strip-count">{{ items.length }}</span>
      </button>
      <button type="button" class="btn-ghost btn-xs" :aria-pressed="mode === 'work'" data-test="strip-feedback" @click.stop="onFeedback">Get feedback</button>
    </header>

    <!-- v-show, not v-if: a half-typed answer must survive collapsing the strip to its line. -->
    <div v-show="mode !== 'line'">
      <p v-if="changes" class="waiting" data-test="strip-changes">{{ changesLine }}</p>
      <template v-if="!expanded">
        <div v-if="current" class="mt-2">
          <StripItemView :key="current.id" :item="current" />
          <div v-if="items.length > 1" class="flex items-center justify-between mt-1.5">
            <span class="sub">{{ index + 1 }} of {{ items.length }}</span>
            <span class="flex gap-1.5">
              <button type="button" class="btn-ghost btn-xs" :aria-pressed="false" data-test="strip-expand" @click="expanded = true">All</button>
              <button type="button" class="btn-ghost btn-xs" data-test="strip-next" @click="next">Next</button>
            </span>
          </div>
        </div>
        <p v-else class="sub mt-1" data-test="strip-empty">No open questions.</p>
      </template>
      <div v-else class="mt-2">
        <div class="list" data-test="strip-list">
          <StripItemView v-for="it in items" :key="it.id" :item="it" />
          <p v-if="!items.length" class="sub" data-test="strip-empty">No open questions.</p>
        </div>
        <button type="button" class="btn-ghost btn-xs mt-1.5" :aria-pressed="true" data-test="strip-expand" @click="expanded = false">One at a time</button>
      </div>
    </div>

    <!-- v-show, not v-if: a run's pasted reply must survive collapsing the strip. -->
    <div v-show="mode === 'work'" class="mt-2" data-test="strip-run">
      <RunStep title="Read my new notes and changed tasks" :waiting="waiting" :compose="compose" :check="check" :store="store" />
    </div>
  </section>
</template>

<style scoped>
.strip { color: var(--glass-text); }
.strip-line { padding: 0.55rem 0.75rem 0.55rem 1rem; } /* one line: the dock at rest */
.strip-open { padding: 0.9rem 1rem; }
.strip {
  position: relative;
  z-index: 1; /* above the cards' shadow room, which runs under it */
  max-height: 72%; /* grows upwards in work mode, never off the top */
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y; /* a scroll container: restate pan-y or a sideways swipe on it fights the pager */
  /* The theme's solid surface (the nav bar's), not glass: the last card's shadow and a card mid-scroll pass under it. */
  background: rgb(var(--s-900) / 0.96);
}
.line { position: sticky; top: 0; z-index: 1; background: inherit; } /* stays in reach while a long run scrolls */
.line { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; cursor: pointer; }
.title { flex: 1; text-align: left; font-weight: 600; font-size: 0.875rem; background: none; color: inherit; padding: 0.15rem 0; }
.count { font-size: 0.75rem; color: var(--glass-sub); margin-left: 0.25rem; }
.waiting { font-size: 0.78rem; color: #fbbf24; margin-top: 0.3rem; }
.sub { font-size: 0.75rem; color: var(--glass-sub); }
.list { display: flex; flex-direction: column; gap: 0.75rem; max-height: 60dvh; overflow-y: auto; touch-action: pan-y; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
</style>
