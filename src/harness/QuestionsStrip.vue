<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isBodyTap } from '@/composables/bodyTap'
import { syncSoon } from '@/sync'
import { applyHarnessReply2, pendingHarness2, startHarness2 } from './loop2'
import { proposalLabel, runSummary2, waitingShort } from './queue2'
import { opensOnArrival, type ModelVia } from '@/ai/runWith'
import RunStep, { type Check } from './RunStep.vue'
import StripItemView from './StripItemView.vue'
import type { Loop2 } from './useLoop2'

// The questions strip (HW-HARNESS §11 Dashboard v2, D-70): each question or proposal under the Task it isolates, one
// reply each. The run (the account's model, D-113) reads new notes and the Tasks changed since their last run ("N changes waiting
// for feedback", D-72 until an automatic run exists).
//
// Docked under the Dashboard's scrolling cards (owner, calibration 2026-10-12): a suggestion to start a context round,
// never a demand on the eye. Shown only when there is something to act on — questions in the queue, changes waiting for a
// run (the only way to start the first run, which is what creates questions), or a run in progress. Three states:
// - `line` — at rest: Questions · count · Get feedback.
// - `open` — a tap on the body: the detail view, read only — what is waiting and the next question. A second tap closes it.
// - `work` — Get feedback, from either: every question in the queue with its own reply, then the run. The strip grows
//   upwards (capped; it scrolls inside).
// A tap anywhere outside the strip returns it to `line`. Nothing is lost on the way: a half-typed answer stays where it
// was (v-show), so tapping back in finds it. A run whose model call is still out opens in `work`, so its answer shows
// when it arrives.
const props = defineProps<{ loop: Loop2 }>()
const items = computed(() => props.loop.items.value)
const first = computed(() => items.value[0] ?? null)
const waiting = ref(pendingHarness2() !== null)
const waitingRunId = pendingHarness2()?.runId ?? null
type Mode = 'line' | 'open' | 'work'
const mode = ref<Mode>(opensOnArrival('harness', waitingRunId) ? 'work' : 'line')
const root = ref<HTMLElement | null>(null)

const changes = computed(() => props.loop.work.value.notes + props.loop.work.value.tasks)
const visible = computed(() => items.value.length > 0 || changes.value > 0 || waiting.value || mode.value === 'work')
// One kind: say it once ("3 new notes waiting for feedback"); both: the total, then the parts.
const changesLine = computed(() => {
  const { notes, tasks } = props.loop.work.value
  const parts = [notes ? `${notes} new note${notes === 1 ? '' : 's'}` : '', tasks ? `${tasks} changed task${tasks === 1 ? '' : 's'}` : ''].filter(Boolean)
  if (parts.length < 2) return `${parts[0] ?? ''} waiting for feedback`
  return `${changes.value} changes waiting for feedback: ${parts.join(' · ')}`
})
/** At rest, what waits (G5): with no question yet, "Questions 0" alone read as nothing to do. */
const restHint = computed(() => waitingShort(props.loop.work.value.notes, props.loop.work.value.tasks))
const preview = computed(() => {
  const it = first.value
  if (!it) return null
  return { about: it.about, text: it.kind === 'question' ? it.question.text : proposalLabel(it.proposal, it.tasks) }
})

/** A tap on the body (not on a control): line ↔ open; in work, only the header line collapses it. */
function onBody(e: MouseEvent) {
  if (!isBodyTap(e, '[data-test="strip-toggle"]')) return
  const t = e.target as HTMLElement
  if (mode.value === 'work') {
    if (t.closest('[data-test="strip-line"]')) mode.value = 'line'
    return
  }
  mode.value = mode.value === 'line' ? 'open' : 'line'
}
const onFeedback = () => (mode.value = mode.value === 'work' ? 'line' : 'work')

// Tap away: back to the line. On click, not pointer-down: a scroll or a page swipe makes no click, so it never closes the
// strip, and by the time a click fires the browser has picked its target — the cards moving as the strip shrinks cannot
// send the tap to a different button. Capture phase, so it runs before the tapped control's own handler.
function onDocClick(e: MouseEvent) {
  if (mode.value !== 'line' && root.value && !root.value.contains(e.target as Node)) mode.value = 'line'
}
onMounted(() => document.addEventListener('click', onDocClick, true))

// Daily's Refresh (the owner asks for an update where the Tasks are): open the run and start it. The model's reply is
// checked and stored by itself (D-103).
const runStep = ref<InstanceType<typeof RunStep> | null>(null)
watch(() => props.loop.refresh.value, async () => {
  mode.value = 'work'
  await nextTick()
  void runStep.value?.go()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true))

async function compose() {
  const out = await startHarness2()
  waiting.value = out !== null
  if (!out) return null
  const tasks = out.header.reevaluateIds.length
  const fresh = out.header.toAssessIds.length
  const context = out.header.contextIds.length
  // Say which notes are read and which only go along: "6 notes went" with nothing new read looked like the run ignored them.
  const extra = [
    fresh ? `${fresh} new to read${context ? `, ${context} earlier for context` : ''}.` : context ? `No new notes to read: ${context} earlier note${context === 1 ? '' : 's'} go${context === 1 ? 'es' : ''} as context.` : '',
    tasks ? `${tasks} changed task${tasks === 1 ? '' : 's'} to re-read.` : '',
    out.header.remaining > 0 ? `${out.header.remaining} more note${out.header.remaining === 1 ? ' waits' : 's wait'} for the next run.` : '',
  ]
  return { prompt: out.prompt, notes: out.header.toAssessIds.length + out.header.contextIds.length, note: extra.filter(Boolean).join(' ') || undefined, runId: out.header.runId }
}
async function check(reply: string): Promise<Check> {
  const r = await applyHarnessReply2(reply, { store: false })
  return r.ok ? { ok: true, lines: runSummary2(r.value.applied, r.value.header) } : r
}
async function store(reply: string, via?: ModelVia) {
  const r = await applyHarnessReply2(reply, { store: true, via })
  if (!r.ok) return r
  waiting.value = false
  syncSoon()
  const a = r.value.applied
  if (a.assessments.length === 0) return { ok: true as const, message: 'Nothing new was stored (a replay, or every row was dropped).' }
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return { ok: true as const, message: `Stored: ${n(a.tasks.length, 'task')} touched, ${n(a.questions.length, 'question')}, ${n(a.proposals.length, 'proposal')}.` }
}
</script>

<template>
  <section v-if="visible" ref="root" class="card strip" :class="`strip-${mode}`" data-test="questions-strip" :data-mode="mode" aria-label="Questions" @click="onBody">
    <header class="line" data-test="strip-line">
      <button type="button" class="title" :aria-expanded="mode !== 'line'" data-test="strip-toggle">
        Questions <span class="count" data-test="strip-count">{{ items.length }}</span><span v-if="mode === 'line' && restHint" class="hint" data-test="strip-rest-hint"> · {{ restHint }} waiting</span>
      </button>
      <button type="button" class="btn-ghost btn-xs" :aria-pressed="mode === 'work'" data-test="strip-feedback" @click="onFeedback">Get feedback</button>
    </header>

    <!-- open: the detail view, read only -->
    <div v-show="mode === 'open'" class="detail" data-test="strip-detail">
      <p v-if="changes" class="waiting" data-test="strip-changes">{{ changesLine }}</p>
      <template v-if="preview">
        <p class="about"><span class="tag">Next</span> {{ preview.about }}</p>
        <p class="ask" data-test="strip-preview">{{ preview.text }}</p>
        <p v-if="items.length > 1" class="sub mt-1">and {{ items.length - 1 }} more — Get feedback to answer</p>
        <p v-else class="sub mt-1">Get feedback to answer</p>
      </template>
      <p v-else class="sub mt-1" data-test="strip-empty">No open questions. Get feedback reads the waiting changes.</p>
    </div>

    <!-- work: every question with its own reply, then the run. v-show, not v-if: typed answers and a running call survive
         the strip closing. -->
    <div v-show="mode === 'work'" data-test="strip-work">
      <p v-if="changes" class="waiting" data-test="strip-changes-work">{{ changesLine }}</p>
      <div v-if="items.length" class="list mt-2" data-test="strip-list">
        <StripItemView v-for="it in items" :key="it.id" :item="it" />
      </div>
      <div class="mt-3" data-test="strip-run">
        <RunStep ref="runStep" title="Read my new notes and changed tasks" stage="harness" :waiting="waiting" :waiting-run-id="waitingRunId" :compose="compose" :check="check" :store="store" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.strip {
  color: var(--glass-text);
  max-height: 100%; /* the dock's cap (68% of the page, DashboardView): work grows upwards, never off the top */
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y; /* a scroll container: restate pan-y or a sideways swipe on it fights the pager */
  /* The theme's solid surface (the nav bar's), not glass: cards scroll under it. */
  background: rgb(var(--s-900) / 0.96);
}
.strip-line { padding: 0.55rem 0.75rem 0.55rem 1rem; cursor: pointer; } /* one line: the dock at rest */
.strip-open { padding: 0.9rem 1rem; cursor: pointer; }
.strip-work { padding: 0 1rem 0.9rem; }
.line { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.strip-work .line { position: sticky; top: 0; z-index: 1; background: inherit; padding: 0.9rem 0 0.4rem; cursor: pointer; } /* stays in reach */
.title { flex: 1; text-align: left; background: none; color: inherit; font-weight: 600; font-size: 0.875rem; padding: 0.15rem 0; }
.count { font-size: 0.75rem; color: var(--glass-sub); margin-left: 0.25rem; }
.hint { font-size: 0.75rem; color: var(--glass-warn); font-weight: 400; } /* the same tone as the waiting line in the detail view */
.waiting { font-size: 0.78rem; color: var(--glass-warn); margin-top: 0.3rem; }
.detail .about { font-size: 0.75rem; color: var(--glass-sub); margin-top: 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: #a7f3d0; }
.ask { font-size: 0.9rem; margin-top: 0.15rem; overflow-wrap: anywhere; }
.sub { font-size: 0.75rem; color: var(--glass-sub); }
.list { display: flex; flex-direction: column; gap: 0.9rem; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
</style>
