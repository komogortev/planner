<script setup lang="ts">
import CardMenu from '@/widgets/CardMenu.vue'
import { cardTint } from '@/widgets/tints'
import { useWidgets } from '@/widgets/useWidgets'
import { isBodyTap } from '@/composables/bodyTap'
import { computed, onBeforeUnmount, ref } from 'vue'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { localDay } from '@/domain/harness'
import { SUMMARY_LENS } from '@/domain/summaryLens'
import { syncSoon } from '@/sync'
import { deviceZone } from './loop'
import { applySummaryReply, pendingSummary, startSummary, todayBuckets } from './summaryRun'
import { ageLabel, reportLines } from './report'
import { opensOnArrival, type ModelVia } from '@/ai/runWith'
import RunStep, { type Check } from './RunStep.vue'

// Summary v3 (D-109, R3): the day in four lists read from the Task rows (no model call, always current), and an evening
// brief the model writes over them on request. Collapsed to its count line unless a run is waiting.
const waiting = ref(pendingSummary() !== null)
const waitingRunId = pendingSummary()?.runId ?? null

// The card can stay mounted past midnight: the clock moves once a minute, so the lists follow the day.
const now = ref(new Date().toISOString())
const tick = setInterval(() => (now.value = new Date().toISOString()), 60_000)
onBeforeUnmount(() => clearInterval(tick))

const tasks = useLiveQuery(() => db.tasks.toArray(), [])
const day = computed(() => todayBuckets(tasks.value, now.value))
const sections = computed(() => [
  { key: 'done', label: 'Done today', rows: day.value.done },
  { key: 'moved', label: 'Now on a later day', rows: day.value.moved },
  { key: 'open', label: 'Still open', rows: day.value.open },
  { key: 'dropped', label: 'Dropped', rows: day.value.dropped },
])
const counts = computed(() => sections.value.filter((s) => s.rows.length).map((s) => `${s.rows.length} ${s.key === 'moved' ? 'later' : s.key}`).join(' · ') || 'Nothing on today yet')

const reports = useLiveQuery(() => db.reports.where('widgetId').equals(SUMMARY_LENS.id).sortBy('ranAt'), [])
const latest = computed(() => [...reports.value].reverse().find((r) => !r.deletedAt) ?? null)
const briefToday = computed(() => latest.value !== null && localDay(latest.value.ranAt, deviceZone()) === localDay(now.value, deviceZone()) ? latest.value : null)
const lines = computed(() => (briefToday.value ? reportLines(briefToday.value.body) : []))
const open = ref(opensOnArrival('widget', waitingRunId))

async function compose() {
  const out = await startSummary()
  waiting.value = out !== null
  if (!out) return null
  return { prompt: out.prompt, notes: out.header.entryIds.length, note: out.header.truncated ? `${out.header.truncated} older notes were left out (cap).` : undefined, runId: out.header.runId }
}
async function check(reply: string): Promise<Check> {
  const r = await applySummaryReply(reply, { store: false })
  if (!r.ok) return r
  const rep = r.value.report
  return {
    ok: true,
    lines: [
      `${reportLines(rep.body).length} lines · ${rep.citations.length} citation${rep.citations.length === 1 ? '' : 's'} kept`,
      ...(rep.droppedCitations ? [`${rep.droppedCitations} citation(s) dropped: the model cited something the notes do not say. The brief will be flagged.`] : []),
    ],
  }
}
async function store(reply: string, via?: ModelVia) {
  const r = await applySummaryReply(reply, { store: true, via })
  if (!r.ok) return r
  waiting.value = false
  syncSoon()
  return { ok: true as const, message: 'Brief stored.' }
}

// Body tap (calibration 2026-10-12): closed, a tap anywhere opens; open, only the header closes it.
function onBody(e: MouseEvent) {
  if (!isBodyTap(e)) return
  if (!open.value) open.value = true
  else if ((e.target as Element).closest('[data-test="summary-head"]')) open.value = false
}
const { tintOf } = useWidgets()
</script>

<template>
  <section class="card loop" :class="{ 'tap-to-open': !open }" v-bind="cardTint(tintOf('system-summary'))" data-test="summary-card" aria-label="Summary" @click="onBody">
    <header class="flex items-baseline justify-between gap-2" data-test="summary-head">
      <div class="min-w-0">
        <h3 class="font-semibold">Summary</h3>
        <p class="sub" data-test="summary-counts">{{ counts }}</p>
      </div>
      <div class="flex gap-1.5 items-center shrink-0">
        <button type="button" class="btn-ghost btn-xs" :aria-expanded="open" data-test="summary-toggle" @click.stop="open = !open">{{ open ? 'Hide' : 'Open' }}</button>
        <CardMenu widget-id="system-summary" label="Summary options" />
      </div>
    </header>
    <div v-show="open">
      <template v-for="s in sections" :key="s.key">
        <div v-if="s.rows.length" class="bucket" :data-test="`summary-${s.key}`">
          <p class="label">{{ s.label }} · {{ s.rows.length }}</p>
          <ul class="lines">
            <li v-for="t in s.rows" :key="t.id" :class="`b-${s.key}`">{{ t.text }}</li>
          </ul>
        </div>
      </template>
      <div v-if="briefToday" class="report" data-test="summary-brief">
        <p class="label">
          Brief · written {{ ageLabel(briefToday.ranAt) }}
          <span v-if="briefToday.droppedCitations" class="flag" data-test="summary-flag"> · ⚠ {{ briefToday.droppedCitations }} unsupported citation(s) dropped</span>
        </p>
        <ul class="lines">
          <li v-for="(l, i) in lines" :key="i" :class="`k-${l.kind}`" :style="'depth' in l ? { paddingLeft: `${l.depth}rem` } : undefined">
            <template v-if="l.kind === 'check'">{{ l.done ? '☑' : '☐' }} {{ l.text }}</template>
            <template v-else-if="l.kind === 'bullet'">• {{ l.text }}</template>
            <template v-else>{{ l.text }}</template>
          </li>
        </ul>
      </div>
      <div data-test="step-summary">
        <RunStep title="Write the evening brief" stage="widget" :waiting="waiting" :waiting-run-id="waitingRunId" :compose="compose" empty-text="Nothing to sum up: no Task was done, moved, dropped or is open today." :check="check" :store="store" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.tap-to-open { cursor: pointer; }
.loop { color: var(--glass-text); }
.sub { font-size: 0.78rem; color: var(--glass-sub); }
.label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em; color: var(--glass-sub); margin-top: 0.6rem; }
.flag { color: var(--glass-warn); }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
.report { margin: 0.25rem 0 0.75rem; }
.lines { margin-top: 0.25rem; font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; }
.lines li { white-space: pre-wrap; overflow-wrap: anywhere; }
.b-done { text-decoration: line-through; opacity: 0.75; }
.b-dropped { opacity: 0.6; }
.k-heading { font-weight: 600; margin-top: 0.4rem; }
</style>
