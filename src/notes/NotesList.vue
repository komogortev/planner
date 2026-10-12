<script setup lang="ts">
import type { EntryState } from '@/domain/harness'
import type { DayGroup } from './group'
import { timeLabel } from './group'

// Presentational. Bodies are plain text: they are rendered through interpolation (escaped), never as HTML, and the
// first lines are clipped with CSS so the owner's text is never rewritten (H1-ENTRIES §10, render escaping).
// Notes are input only since Dashboard v2 (HW-HARNESS §11 P4): their questions are asked in the strip, under the Task they
// isolate. A note keeps one action — drop it as junk (never assessed again) or bring it back — when `states` is given.
const props = defineProps<{ groups: DayGroup[]; unsynced: ReadonlySet<string>; zone?: string; states?: ReadonlyMap<string, EntryState> }>()
defineEmits<{ drop: [id: string]; restore: [id: string] }>()
// Any closed note can come back (a v1 "done" note too): restore reopens it, and the next run reads it.
const isClosed = (id: string) => (props.states?.get(id)?.state ?? 'open') !== 'open'
</script>

<template>
  <div class="notes">
    <section v-for="g in groups" :key="g.day" class="day">
      <h4 class="day-head" data-test="day-head">{{ g.label }}</h4>
      <ul>
        <li v-for="e in g.entries" :key="e.id" class="row" :class="{ closed: states?.get(e.id) && states.get(e.id)!.state !== 'open' }" data-test="note-row">
          <span class="time">{{ timeLabel(e.createdAt, zone) }}</span>
          <span class="body" data-test="note-body">{{ e.body }}</span>
          <span v-if="unsynced.has(e.id)" class="pending" data-test="note-unsynced" title="Not on the server yet" aria-label="not synced yet">●</span>
          <button v-if="states && isClosed(e.id)" type="button" class="act" title="Bring this note back" data-test="note-restore" @click="$emit('restore', e.id)">restore</button>
          <button v-else-if="states" type="button" class="act" aria-label="Drop this note" title="Drop this note (junk: never read again)" data-test="note-drop" @click="$emit('drop', e.id)">✕</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.day-head { font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--glass-sub); margin: 0.9rem 0 0.35rem; }
.row { display: grid; grid-template-columns: 3.2rem 1fr auto auto; gap: 0.5rem; align-items: start; padding: 0.35rem 0; border-top: 1px solid var(--glass-edge); }
.time { font-size: 0.75rem; color: var(--glass-sub); font-variant-numeric: tabular-nums; padding-top: 0.1rem; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; color: var(--glass-text); font-size: 0.9rem; }
.closed .body { text-decoration: line-through; opacity: 0.6; }
.pending { font-size: 0.6rem; color: #e0a458; padding-top: 0.3rem; }
.act { font-size: 0.72rem; color: var(--glass-sub); background: none; padding: 0.1rem 0.25rem; grid-column: 4; }
</style>
