<script setup lang="ts">
import { isBodyTap } from '@/composables/bodyTap'
import { computed, ref } from 'vue'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { localDay } from '@/domain/harness'
import { JOURNAL_LENS } from '@/domain/journal'
import { syncSoon } from '@/sync'
import { applyJournalReply, deviceZone, pendingJournal, startJournal } from './loop'
import { ageLabel, reportLines } from './report'
import RunStep, { type Check } from './RunStep.vue'

// The AI journal (HW-HARNESS §11 P2: optional since Dashboard v2): a written summary of today's notes, one copy-prompt round
// trip (D-63). Daily itself needs no paste — the harness run lives in the questions strip. Collapsed unless a run is waiting.
const journalWaiting = ref(pendingJournal() !== null)

const reports = useLiveQuery(() => db.reports.where('widgetId').equals(JOURNAL_LENS.id).sortBy('ranAt'), [])
const latest = computed(() => [...reports.value].reverse().find((r) => !r.deletedAt) ?? null)
const lines = computed(() => (latest.value ? reportLines(latest.value.body) : []))
const writtenToday = computed(() => latest.value !== null && localDay(latest.value.ranAt, deviceZone()) === localDay(new Date().toISOString(), deviceZone()))
const open = ref(journalWaiting.value)

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

// A body tap (calibration 2026-10-12) does what Open / Hide does: closed, a tap anywhere on the card opens it; open, only
// the header closes it — the open card holds the run's fields and the written report, which are read and typed in.
function onBody(e: MouseEvent) {
  if (!isBodyTap(e)) return
  if (!open.value) open.value = true
  else if ((e.target as Element).closest('[data-test="journal-head"]')) open.value = false
}
</script>

<template>
  <section class="card loop" :class="{ 'tap-to-open': !open }" data-test="journal-card" aria-label="Summarize" @click="onBody">
    <header class="flex items-baseline justify-between" data-test="journal-head">
      <h3 class="font-semibold">Summarize <span class="sub">optional</span></h3>
      <button type="button" class="btn-ghost btn-xs" :aria-expanded="open" data-test="journal-toggle" @click.stop="open = !open">{{ open ? 'Hide' : writtenToday ? 'Show' : 'Open' }}</button>
    </header>
    <div v-show="open">
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
      <p v-else class="sub" data-test="journal-empty">No summary yet.</p>
      <div data-test="step-journal">
        <RunStep title="Write today's summary" :waiting="journalWaiting" :compose="composeJournalPrompt" :check="checkJournal" :store="storeJournal" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.tap-to-open { cursor: pointer; }
.loop { color: var(--glass-text); }
.sub { font-size: 0.78rem; color: var(--glass-sub); }
.flag { color: #fbbf24; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
.report { margin: 0.5rem 0 0.75rem; }
.lines { margin-top: 0.4rem; font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; }
.k-heading { font-weight: 600; margin-top: 0.4rem; }
.lines li { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
