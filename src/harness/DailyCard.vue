<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { addDays } from '@/domain/harness'
import { summaryText, type SummaryPlan } from '@/domain/summary'
import type { Task, TaskState } from '@/domain/tasks'
import { syncSoon } from '@/sync'
import type { Outcome } from './loop'
import { addTask2, editTask2, previewSummary, saveSummary, setTaskState2 } from './loop2'
import type { Loop2 } from './useLoop2'

// Daily (HW-HARNESS §11, D-69/D-71): the open Tasks whose day has come, computed on the device — no paste. Each Task:
// done · tomorrow · drop, shown on the row tapped (D-104: buttons on every row read as "waiting for you"), and a second
// tap on the open row's text edits it (owner text from then on; it enters the next run). "+ task" adds one by
// hand. "Edit summary" opens the list as text: a changed line edits its Task, a new line adds one, and a removed line
// carries its Task to tomorrow with a question (D-73) — shown before saving.
const props = defineProps<{ loop: Loop2 }>()
const tasks = computed(() => props.loop.day.value.tasks)
const day = computed(() => props.loop.day.value.day)
const upcoming = computed(() => props.loop.day.value.upcoming)
// A task on Daily is due today by being here: its date shows only when it is another day (overdue). Owner, 2026-10-13.
// D-101: a widget shows a few lines until tapped open. Three across both lists, today's first, then Coming up.
const COLLAPSED_LINES = 3
const expanded = ref(false)
const shownTasks = computed(() => (expanded.value ? tasks.value : tasks.value.slice(0, COLLAPSED_LINES)))
const shownUpcoming = computed(() => (expanded.value ? upcoming.value : upcoming.value.slice(0, Math.max(0, COLLAPSED_LINES - tasks.value.length))))
const hiddenCount = computed(() => tasks.value.length + upcoming.value.length - shownTasks.value.length - shownUpcoming.value.length)
const canCollapse = computed(() => tasks.value.length + upcoming.value.length > COLLAPSED_LINES)
// Back to a few lines once the list fits, and on a new day (the card can stay mounted past midnight).
watch(canCollapse, (c) => { if (!c) expanded.value = false })
watch(day, () => (expanded.value = false))
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)
function closeMenu() {
  menuOpen.value = false
  menuButton.value?.focus()
}
const cardRoot = ref<HTMLElement | null>(null)
// D-104: one row at a time shows its actions. A tap outside the card puts them away.
const activeId = ref<string | null>(null)
const onDocClick = (e: MouseEvent) => {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) menuOpen.value = false
  if (activeId.value && cardRoot.value && !cardRoot.value.contains(e.target as Node)) activeId.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
// New notes, answers or edits not yet read by a run: Refresh re-runs the analysis with them (D-72's trigger, on Daily).
const waitingWork = computed(() => {
  const { notes, tasks: changed } = props.loop.work.value
  return [notes ? `${notes} new note${notes === 1 ? '' : 's'}` : '', changed ? `${changed} changed task${changed === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
})

const error = ref<string | null>(null)
const busy = ref(false)
// Taps run one after another, never dropped: the blur that saves an edit and the ✓ tapped right after both happen, in that
// order, and each re-reads its row (loop2), so neither writes over the other.
let chain: Promise<unknown> = Promise.resolve()
function act(fn: () => Promise<Outcome<number>>): Promise<boolean> {
  const run = chain.then(async () => {
    busy.value = true
    error.value = null
    try {
      const r = await fn()
      if (!r.ok) {
        error.value = r.error
        return false
      }
      syncSoon()
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      busy.value = false
    }
  })
  chain = run
  return run
}

// done · tomorrow · drop take the Task off Daily; the last one can be undone (a thumb on the wrong button). One tap per
// Task at a time: a double tap is one action.
const undo = ref<{ task: Task; label: string } | null>(null)
const tapping = new Set<string>()
async function close(t: Task, label: string, state: TaskState, followUpOn: string | null = null) {
  if (tapping.has(t.id)) return
  tapping.add(t.id)
  try {
    if (await act(() => setTaskState2(t, state, followUpOn))) undo.value = { task: { ...t }, label }
  } finally {
    tapping.delete(t.id)
  }
}
const done = (t: Task) => close(t, 'Done', 'done')
const tomorrow = (t: Task) => close(t, 'Moved to tomorrow', 'open', addDays(day.value, 1))
const drop = (t: Task) => close(t, 'Dropped', 'dropped')
// Coming up → today: the owner's own pick-up day (a carry to today), so a deadline gets its lead time. Undo puts it back.
const pullToday = (t: Task) => close(t, 'Moved to today', 'open', day.value)
async function undoLast() {
  const u = undo.value
  if (u && (await act(() => setTaskState2(u.task, 'open', u.task.followUpOn)))) undo.value = null
}

// Tap-to-edit: one Task at a time.
const editingId = ref<string | null>(null)
const draft = ref('')
function startEdit(t: Task) {
  editingId.value = t.id
  draft.value = t.text
}
/** First tap shows the row's actions; a tap on the open row's text edits it. */
function tapRow(t: Task) {
  if (activeId.value === t.id) startEdit(t)
  else activeId.value = t.id
}
async function saveEdit(t: Task) {
  if (editingId.value !== t.id) return // Enter already saved; the blur that follows the input's removal is not a second edit
  const text = draft.value // read now: tapping another Task's text replaces the draft before this save resolves
  if (text.trim() === t.text) editingId.value = null
  else if ((await act(() => editTask2(t, { text }))) && editingId.value === t.id) editingId.value = null
}

const newText = ref('')
async function add() {
  if (newText.value.trim() && (await act(() => addTask2(newText.value)))) {
    newText.value = ''
    expanded.value = true // a new Task sorts last: collapsed, it would land in the hidden part and the tap would look lost
  }
}

// The summary editor works on the list as it was when it opened: saving is refused if any of it changed meanwhile.
const summaryOpen = ref(false)
const shown = ref<Task[]>([])
const summary = ref('')
const plan = ref<SummaryPlan | null>(null)
function openSummary() {
  shown.value = tasks.value.map((t) => ({ ...t }))
  summary.value = summaryText(shown.value)
  plan.value = null
  error.value = null
  summaryOpen.value = true
}
const previewIt = () => (plan.value = previewSummary(shown.value, summary.value))
const changesCount = computed(() => (plan.value ? plan.value.edits.length + plan.value.adds.length + plan.value.removes.length : 0))
async function saveIt() {
  if (await act(() => saveSummary(shown.value, summary.value))) {
    summaryOpen.value = false
    plan.value = null
    return
  }
  // Refused (most often: the list changed meanwhile). The owner's text stays; the diff is redone against the list as it is now.
  shown.value = tasks.value.map((t) => ({ ...t }))
  plan.value = null
  error.value = `${error.value ?? ''} Your text is kept — Preview again to see it against the list as it is now.`.trim()
}
</script>

<template>
  <section ref="cardRoot" class="card daily" data-test="daily-card" aria-label="Daily">
    <header class="flex items-center justify-between gap-2">
      <h3 class="font-semibold">Daily <span class="sub">{{ day }}</span></h3>
      <div v-if="!summaryOpen" class="flex gap-1.5 items-center">
        <button
          type="button" class="btn-ghost btn-xs" :disabled="!waitingWork" :title="waitingWork || 'Nothing new to read'"
          :aria-label="waitingWork ? `Refresh: ${waitingWork}` : 'Refresh: nothing new to read'" data-test="daily-refresh"
          @click="props.loop.refresh.value++"
        >Refresh</button>
        <!-- Widget options (edit summary now; edit or remove the widget later) live behind ⋯, so the header holds one action. -->
        <div ref="menuRoot" class="menu" @keydown.esc="closeMenu">
          <button
            ref="menuButton" type="button" class="btn-ghost btn-xs" aria-label="Daily options" aria-controls="daily-menu-list" :aria-expanded="menuOpen"
            data-test="daily-menu" @click="menuOpen = !menuOpen"
          >⋯</button>
          <div v-if="menuOpen" id="daily-menu-list" class="menu-list" data-test="daily-menu-list">
            <button type="button" :disabled="!tasks.length" data-test="daily-edit-summary" @click="menuOpen = false; openSummary()">Edit summary</button>
          </div>
        </div>
      </div>
    </header>

    <template v-if="!summaryOpen">
      <ul class="tasks" data-test="daily-tasks">
        <li v-for="t in shownTasks" :key="t.id" class="task" data-test="daily-task">
          <input v-if="editingId === t.id" v-model="draft" class="input in" aria-label="Task text" data-test="daily-task-input" @keydown.enter="saveEdit(t)" @keydown.esc="editingId = null" @blur="saveEdit(t)" />
          <button
            v-else type="button" class="text" :title="activeId === t.id ? 'Edit' : 'Show actions'" :aria-expanded="activeId === t.id"
            data-test="daily-task-text" @click="tapRow(t)"
          >
            {{ t.text }}<span v-if="t.due && t.due !== day" class="due"> · due {{ t.due }}</span>
          </button>
          <div v-if="activeId === t.id || editingId === t.id" class="acts" data-test="daily-task-acts">
            <button type="button" class="btn-ghost btn-xs" aria-label="Done" title="Done" data-test="daily-done" @click="done(t)">✓</button>
            <button type="button" class="btn-ghost btn-xs" aria-label="Tomorrow" title="Tomorrow" data-test="daily-tomorrow" @click="tomorrow(t)">→</button>
            <button type="button" class="btn-ghost btn-xs" aria-label="Drop" title="Drop" data-test="daily-drop" @click="drop(t)">✕</button>
          </div>
        </li>
      </ul>
      <p v-if="undo" class="sub mt-1" data-test="daily-undo-line">
        {{ undo.label }}: “{{ undo.task.text }}” · <button type="button" class="link" data-test="daily-undo" @click="undoLast">Undo</button>
      </p>
      <p v-if="!tasks.length" class="sub mt-1" data-test="daily-empty">Nothing for today. Tasks come from your notes after Get feedback, or add one here.</p>
      <div class="flex gap-1.5 mt-2">
        <input v-model="newText" class="input in" placeholder="+ task" aria-label="New task" data-test="daily-add-input" @keydown.enter="add" />
        <button type="button" class="btn-ghost btn-xs" :disabled="busy || !newText.trim()" data-test="daily-add" @click="add">Add</button>
      </div>
      <div v-if="shownUpcoming.length" class="upcoming" data-test="daily-upcoming">
        <p class="sub">Coming up</p>
        <ul>
          <li v-for="t in shownUpcoming" :key="t.id" class="task soon" data-test="daily-upcoming-task">
            <button type="button" class="text" title="Show actions" :aria-expanded="activeId === t.id" data-test="daily-upcoming-text" @click="activeId = activeId === t.id ? null : t.id">
              {{ t.text }}<span v-if="t.followUpOn || t.due" class="due"> · {{ t.followUpOn ?? `due ${t.due}` }}</span>
            </button>
            <button v-if="activeId === t.id" type="button" class="btn-ghost btn-xs" aria-label="Today" title="Today" data-test="daily-pull-today" @click="pullToday(t)">Today</button>
          </li>
        </ul>
      </div>
      <button
        v-if="canCollapse" type="button" class="link more" :aria-expanded="expanded" :data-test="expanded ? 'daily-less' : 'daily-more'"
        @click="expanded = !expanded"
      >{{ expanded ? 'Show less' : `+${hiddenCount} more` }}</button>
    </template>

    <div v-else data-test="daily-summary">
      <textarea v-model="summary" class="input mt-2 text-sm" rows="6" spellcheck="true" aria-label="Today's summary" data-test="daily-summary-text" @input="plan = null" />
      <ul v-if="plan" class="plan" data-test="daily-summary-plan">
        <li v-for="e in plan.edits" :key="`e-${e.task.id}`">Edit: “{{ e.task.text }}” → “{{ e.text }}”</li>
        <li v-for="(a, i) in plan.adds" :key="`a-${i}`">Add: “{{ a }}”</li>
        <li v-for="r in plan.removes" :key="`r-${r.id}`">Off today: “{{ r.text }}” — moved to tomorrow, and you’ll be asked whether to drop it</li>
        <li v-if="!changesCount">No changes.</li>
      </ul>
      <div class="flex gap-1.5 mt-2">
        <button type="button" class="btn-ghost btn-xs" data-test="daily-summary-cancel" @click="summaryOpen = false">Cancel</button>
        <button v-if="!plan" type="button" class="btn-ghost btn-xs" data-test="daily-summary-preview" @click="previewIt">Preview</button>
        <button v-else type="button" class="btn-primary btn-xs" :disabled="busy || !changesCount" data-test="daily-summary-save" @click="saveIt">Save</button>
      </div>
    </div>
    <p v-if="error" class="err" data-test="daily-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.daily { color: var(--glass-text); }
.sub { font-size: 0.75rem; color: var(--glass-sub); font-weight: 400; }
.tasks { margin-top: 0.4rem; display: flex; flex-direction: column; }
.task { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; border-top: 1px solid var(--glass-edge); }
.text { flex: 1; text-align: left; font-size: 0.92rem; overflow-wrap: anywhere; background: none; color: inherit; padding: 0.1rem 0; }
.due { font-size: 0.75rem; color: var(--glass-warn); }
.upcoming { margin-top: 0.6rem; }
.soon .text { font-size: 0.85rem; color: var(--glass-sub); }
.acts { display: flex; gap: 0.25rem; flex-shrink: 0; }
.in { padding: 0.3rem 0.6rem; font-size: 0.85rem; flex: 1; }
.plan { font-size: 0.8rem; margin-top: 0.5rem; padding-left: 1rem; list-style: disc; display: flex; flex-direction: column; gap: 0.15rem; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
.link { text-decoration: underline; color: var(--glass-text); background: none; padding: 0; }
.err { font-size: 0.75rem; color: #fda4af; margin-top: 0.35rem; }
.menu { position: relative; }
.menu-list { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 10rem; padding: 4px; border-radius: 0.75rem; background: rgb(var(--s-900)); box-shadow: 0 6px 20px rgb(0 0 0 / 0.3); }
.menu-list button { display: block; width: 100%; text-align: left; padding: 0.45rem 0.65rem; border-radius: 0.5rem; font-size: 0.85rem; color: rgb(var(--s-100)); }
.menu-list button:hover:not(:disabled) { background: rgb(var(--s-800)); }
.menu-list button:disabled { opacity: 0.5; }
.more { display: block; margin-top: 0.5rem; font-size: 0.8rem; }
</style>
