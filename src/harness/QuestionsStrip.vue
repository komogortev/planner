<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isBodyTap } from '@/composables/bodyTap'
import { syncSoon } from '@/sync'
import { applyHarnessReply2, pendingHarness2, startHarness2 } from './loop2'
import { proposalLabel, runSummary2, waitingShort } from './queue2'
import { opensOnArrival, type ModelVia } from '@/ai/runWith'
import RunStep, { type Check } from './RunStep.vue'
import StripItemView from './StripItemView.vue'
import FreeNote from './FreeNote.vue'
import type { Loop2 } from './useLoop2'

// The Journal strip (HW-HARNESS §11 Dashboard v2, D-70; named Journal in the UI by G7, owner 2026-10-16): each question or proposal under the Task it isolates, one
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
const questionsLabel = computed(() => (items.value.length ? `${items.value.length} question${items.value.length === 1 ? '' : 's'}` : ''))
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
// G8 (owner, 2026-10-14): Get feedback commits to answering — the strip opens on the first item with its input ready; the
// body tap stays the read-only detail. With nothing to answer, the free box takes the focus (G9).
// Item views by item id: a v-for ref array does not follow the list's order, and an answered item's unmount (a null ref)
// can land after its successor's mount, so a single "first" slot would be cleared under the next question.
const itemViews = new Map<string, InstanceType<typeof StripItemView>>()
const setItemRef = (id: string, el: unknown) => {
  if (el) itemViews.set(id, el as InstanceType<typeof StripItemView>)
  else itemViews.delete(id)
}
const freeNote = ref<InstanceType<typeof FreeNote> | null>(null)
/** Get feedback's own focus: the first item, or with nothing to answer the free box (G9). Called only from that tap. */
async function focusStart(): Promise<void> {
  await nextTick()
  if (mode.value !== 'work') return
  if (items.value.length) itemViews.get(items.value[0].id)?.focus()
  else freeNote.value?.focus()
}
/**
 * Focus follows the queue only after the owner has started answering in this opening of the strip (CodeReview R5-2): a
 * strip that opens in work on arrival, a first load of the live query, or a sync that answers an item elsewhere never
 * raises the keyboard by itself. Cleared whenever the strip goes back to its line.
 */
const armed = ref(false)
watch(mode, (m) => {
  if (m === 'line') armed.value = false
})
async function onFeedback(): Promise<void> {
  if (mode.value === 'work') {
    mode.value = 'line'
    return
  }
  mode.value = 'work'
  armed.value = true
  await focusStart()
}
// When an answer clears the first item, or a finished run brings new questions, the next question's input is ready without
// another tap — unless the owner is typing somewhere else in the strip (an answer half-written on a later item is never
// left), and never onto the free box: a button that settles the last proposal must not raise the keyboard (R5-5).
watch(() => items.value[0]?.id, async (id, before) => {
  if (id === before || id === undefined || mode.value !== 'work' || !armed.value) return
  const active = typeof document !== 'undefined' ? document.activeElement : null
  const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
  if (typing && root.value?.contains(active) && (active as HTMLInputElement).value.trim() !== '') return
  await nextTick()
  itemViews.get(id)?.focus()
})
// G10 (owner, 2026-10-14): the detail view offers a run only when there is something new to read (synced notes from
// other devices count: the count reads the local tables sync writes into). With nothing new, a rerun has no reason.
async function runThrough(): Promise<void> {
  mode.value = 'work'
  armed.value = true
  await nextTick()
  void runStep.value?.go()
}

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
  <!-- Always shown (G9): with nothing waiting, Get feedback still opens a box to tell the Journal something. -->
  <section ref="root" class="card strip" :class="`strip-${mode}`" data-test="questions-strip" :data-mode="mode" aria-label="Journal" @click="onBody">
    <header class="line" data-test="strip-line">
      <button type="button" class="title" :aria-expanded="mode !== 'line'" data-test="strip-toggle">
        Journal<span v-if="questionsLabel" class="count" data-test="strip-count"> · {{ questionsLabel }}</span><span v-if="mode === 'line' && restHint" class="hint" data-test="strip-rest-hint"> · {{ restHint }}{{ questionsLabel ? '' : ' waiting' }}</span><span v-else-if="mode === 'line' && !questionsLabel" class="count" data-test="strip-rest-none"> · nothing waiting</span>
      </button>
      <button type="button" class="btn-ghost btn-xs" :aria-pressed="mode === 'work'" data-test="strip-feedback" @click="onFeedback">Get feedback</button>
    </header>

    <!-- open: the detail view, read only -->
    <div v-show="mode === 'open'" class="detail" data-test="strip-detail">
      <p v-if="changes" class="waiting" data-test="strip-changes">{{ changesLine }}</p>
      <button v-if="changes" type="button" class="btn-primary btn-xs mt-2" data-test="strip-run-through" @click.stop="runThrough">Run through</button>
      <template v-if="preview">
        <p class="about"><span class="tag">Next</span> {{ preview.about }}</p>
        <p class="ask" data-test="strip-preview">{{ preview.text }}</p>
        <p v-if="items.length > 1" class="sub mt-1">and {{ items.length - 1 }} more — Get feedback to answer</p>
        <p v-else class="sub mt-1">Get feedback to answer</p>
      </template>
      <p v-else-if="changes" class="sub mt-1" data-test="strip-empty">No open questions. Run through reads the waiting changes.</p>

    </div>

    <!-- One free box for both views (G9), kept mounted with v-show: typed text survives questions arriving, a sync, and
         a switch between the views (CodeReview R5-3, R5-4, R5-6). -->
    <FreeNote v-show="mode !== 'line' && !items.length" ref="freeNote" class="free-slot" />
    <!-- work: every question with its own reply, then the run. v-show, not v-if: typed answers and a running call survive
         the strip closing. -->
    <div v-show="mode === 'work'" data-test="strip-work">
      <p v-if="changes" class="waiting" data-test="strip-changes-work">{{ changesLine }}</p>
      <div v-if="items.length" class="list mt-2" data-test="strip-list">
        <StripItemView v-for="it in items" :key="it.id" :ref="(el) => setItemRef(it.id, el)" :item="it" @done="armed = true" />
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
.title { flex: 1; min-width: 0; text-align: left; background: none; color: inherit; font-weight: 600; font-size: 0.875rem; padding: 0.15rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } /* one line at 375 px */
.count { font-size: 0.75rem; color: var(--glass-sub); margin-left: 0.25rem; }
.hint { font-size: 0.75rem; color: var(--glass-warn); font-weight: 400; } /* the same tone as the waiting line in the detail view */
.waiting { font-size: 0.78rem; color: var(--glass-warn); margin-top: 0.3rem; }
.detail .about { font-size: 0.75rem; color: var(--glass-sub); margin-top: 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: #a7f3d0; }
.ask { font-size: 0.9rem; margin-top: 0.15rem; overflow-wrap: anywhere; }
.sub { font-size: 0.75rem; color: var(--glass-sub); }
.list { display: flex; flex-direction: column; gap: 0.9rem; }
.strip-work .free-slot { margin-bottom: 0.25rem; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
</style>
