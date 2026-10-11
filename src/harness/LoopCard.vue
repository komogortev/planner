<script setup lang="ts">
import { computed, ref } from 'vue'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { localDay } from '@/domain/harness'
import { JOURNAL_LENS } from '@/domain/journal'
import { syncSoon } from '@/sync'
import { applyHarnessReply, applyJournalReply, deviceZone, pendingHarness, pendingJournal, startHarness, startJournal } from './loop'
import { ageLabel, harnessSummary, reportLines } from './report'
import RunStep, { type Check } from './RunStep.vue'

// The daily loop (HW-HARNESS §1, S3 thin slice): step 1 assesses new notes (questions + proposals land on the notes
// below), step 2 writes today's Daily task journal from the marked notes. Both are copy-prompt round trips (D-63).
// Widget activation is not built yet: the built-in journal always shows here.
const harnessWaiting = ref(pendingHarness() !== null)
const journalWaiting = ref(pendingJournal() !== null)

const reports = useLiveQuery(() => db.reports.where('widgetId').equals(JOURNAL_LENS.id).sortBy('ranAt'), [])
const latest = computed(() => [...reports.value].reverse().find((r) => !r.deletedAt) ?? null)
const lines = computed(() => (latest.value ? reportLines(latest.value.body) : []))
const runsToday = useLiveQuery(async () => {
  const zone = deviceZone()
  const today = localDay(new Date().toISOString(), zone)
  return (await db.runs.toArray()).filter((r) => !r.deletedAt && localDay(r.ranAt, zone) === today).length
}, 0)

async function composeHarness() {
  const out = await startHarness()
  harnessWaiting.value = out !== null
  if (!out) return null
  const more = out.header.remaining > 0 ? `${out.header.remaining} more wait for the next run.` : undefined
  return { prompt: out.prompt, notes: out.header.toAssessIds.length + out.header.contextIds.length, note: more }
}
async function checkHarness(reply: string): Promise<Check> {
  const r = await applyHarnessReply(reply, { store: false })
  return r.ok ? { ok: true, lines: harnessSummary(r.value.applied, r.value.header.toAssessIds.length) } : r
}
async function storeHarness(reply: string) {
  const r = await applyHarnessReply(reply, { store: true })
  if (!r.ok) return r
  harnessWaiting.value = false
  syncSoon()
  const a = r.value.applied
  if (a.assessments.length === 0) return { ok: true as const, message: 'Nothing new was stored (a replay, or every row was dropped).' }
  return { ok: true as const, message: `Stored: ${a.assessments.length} assessed, ${a.questions.length} questions, ${a.links.length} proposals. They are on the notes below.` }
}

async function composeJournalPrompt() {
  const out = await startJournal()
  journalWaiting.value = out !== null
  if (!out) return null
  return { prompt: out.prompt, notes: out.header.entryIds.length, note: out.header.truncated ? `${out.header.truncated} older notes were left out (cap).` : undefined }
}
async function checkJournal(reply: string): Promise<Check> {
  const r = await applyJournalReply(reply, { store: false })
  if (!r.ok) return r
  const rep = r.value.report
  return {
    ok: true,
    lines: [
      `${reportLines(rep.body).length} lines · ${rep.citations.length} citation${rep.citations.length === 1 ? '' : 's'} kept`,
      ...(rep.droppedCitations ? [`${rep.droppedCitations} citation(s) dropped: the model cited something the notes do not say. The report will be flagged.`] : []),
    ],
  }
}
async function storeJournal(reply: string) {
  const r = await applyJournalReply(reply, { store: true })
  if (!r.ok) return r
  journalWaiting.value = false
  syncSoon()
  return { ok: true as const, message: 'Journal stored.' }
}
</script>

<template>
  <section class="card loop" data-test="loop-card" aria-label="Daily task journal">
    <header class="flex items-baseline justify-between">
      <h3 class="font-semibold">{{ JOURNAL_LENS.name }}</h3>
      <span class="sub" data-test="loop-runs-today">{{ runsToday }} run{{ runsToday === 1 ? '' : 's' }} today</span>
    </header>

    <div v-if="latest" class="report" data-test="journal-report">
      <p class="sub">
        Written {{ ageLabel(latest.ranAt) }}
        <span v-if="latest.droppedCitations" class="flag" data-test="journal-flag"> · ⚠ {{ latest.droppedCitations }} unsupported citation(s) dropped</span>
      </p>
      <ul class="lines">
        <li v-for="(l, i) in lines" :key="i" :class="`k-${l.kind}`" :style="'depth' in l ? { paddingLeft: `${l.depth}rem` } : undefined">
          <template v-if="l.kind === 'check'">{{ l.done ? '☑' : '☐' }} {{ l.text }}</template>
          <template v-else-if="l.kind === 'bullet'">• {{ l.text }}</template>
          <template v-else>{{ l.text }}</template>
        </li>
      </ul>
    </div>
    <p v-else class="sub" data-test="journal-empty">No journal yet. Run step 1, answer what it asks below, then step 2.</p>

    <div data-test="step-harness">
      <RunStep title="1 · Assess new notes" :waiting="harnessWaiting" :compose="composeHarness" :check="checkHarness" :store="storeHarness" />
    </div>
    <div data-test="step-journal">
      <RunStep title="2 · Write today's journal" :waiting="journalWaiting" :compose="composeJournalPrompt" :check="checkJournal" :store="storeJournal" />
    </div>
  </section>
</template>

<style scoped>
.loop { color: var(--glass-text); }
.sub { font-size: 0.78rem; color: var(--glass-sub); }
.flag { color: #fbbf24; }
.report { margin: 0.5rem 0 0.75rem; }
.lines { margin-top: 0.4rem; font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; }
.k-heading { font-weight: 600; margin-top: 0.4rem; }
.lines li { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
