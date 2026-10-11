<script setup lang="ts">
import type { EntryState, Link, Question } from '@/domain/harness'
import NoteMarks from '@/harness/NoteMarks.vue'
import type { DayGroup } from './group'
import { timeLabel } from './group'

// Presentational. Bodies are plain text: they are rendered through interpolation (escaped), never as HTML, and the
// first lines are clipped with CSS so the owner's text is never rewritten (H1-ENTRIES §10, render escaping).
// `marks` (optional) holds what the harness and the owner marked per note; a note with nothing marked shows no extra row.
export interface NoteMarksOf {
  questions: Question[]
  proposals: Link[]
  state: EntryState | null
  answered: number
}
defineProps<{ groups: DayGroup[]; unsynced: ReadonlySet<string>; zone?: string; marks?: ReadonlyMap<string, NoteMarksOf> }>()
</script>

<template>
  <div class="notes">
    <section v-for="g in groups" :key="g.day" class="day">
      <h4 class="day-head" data-test="day-head">{{ g.label }}</h4>
      <ul>
        <li v-for="e in g.entries" :key="e.id" class="row" :class="{ closed: marks?.get(e.id)?.state && marks.get(e.id)!.state!.state !== 'open' }" data-test="note-row">
          <span class="time">{{ timeLabel(e.createdAt, zone) }}</span>
          <span class="body" data-test="note-body">{{ e.body }}</span>
          <span v-if="unsynced.has(e.id)" class="pending" data-test="note-unsynced" title="Not on the server yet" aria-label="not synced yet">●</span>
          <NoteMarks v-if="marks?.get(e.id)" :entry-id="e.id" v-bind="marks.get(e.id)!" />
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.day-head { font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--glass-sub); margin: 0.9rem 0 0.35rem; }
.row { display: grid; grid-template-columns: 3.2rem 1fr auto; gap: 0.5rem; align-items: start; padding: 0.35rem 0; border-top: 1px solid var(--glass-edge); }
.time { font-size: 0.75rem; color: var(--glass-sub); font-variant-numeric: tabular-nums; padding-top: 0.1rem; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; color: var(--glass-text); font-size: 0.9rem; }
.closed .body { text-decoration: line-through; opacity: 0.6; }
.pending { font-size: 0.6rem; color: #e0a458; padding-top: 0.3rem; }
</style>
