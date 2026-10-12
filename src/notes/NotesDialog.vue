<script setup lang="ts">
import { computed, ref } from 'vue'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import type { EntryState } from '@/domain/harness'
import { markNote } from '@/harness/loop'
import { syncSoon } from '@/sync'
import { groupByDay } from './group'
import NotesList from './NotesList.vue'

// D-14a: the vertical slice's list is a frosted-glass dialog on the Dashboard — temporary, replaced by the notes
// widget. No search, filter, edit or delete. The newest 200 are shown; the rest stay in the database.
// Since Dashboard v2 a note's questions are asked in the strip; here a note can only be dropped as junk, or brought back.
const LIMIT = 200
const entries = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().filter((e) => !e.deletedAt).limit(LIMIT).toArray(), [])
const queued = useLiveQuery(() => db.outbox.toArray().then((rows) => rows.map((r) => r.entityId)), [] as string[])
const total = useLiveQuery(() => db.entries.filter((e) => !e.deletedAt).count(), 0)
const states = useLiveQuery(async () => new Map((await db.entryStates.toArray()).filter((s) => !s.deletedAt).map((s): [string, EntryState] => [s.id, s])), new Map<string, EntryState>())
const error = ref<string | null>(null)
// One write per note at a time: a double tap must not drop and then restore (the button changes under the finger).
const inFlight = new Set<string>()
async function setState(id: string, state: 'open' | 'dropped') {
  if (inFlight.has(id)) return
  inFlight.add(id)
  error.value = null
  try {
    const r = await markNote(id, state)
    if (!r.ok) error.value = r.error
    else syncSoon()
  } finally {
    inFlight.delete(id)
  }
}
const groups = computed(() => groupByDay(entries.value))
const unsynced = computed(() => new Set(queued.value))
</script>

<template>
  <section class="card dialog" data-test="notes-dialog" aria-label="Notes">
    <header class="head">
      <h3 class="font-semibold">Notes</h3>
      <span class="count" data-test="notes-count">{{ total }}</span>
    </header>
    <p v-if="total === 0" class="empty" data-test="notes-empty">Nothing captured yet. Write something on Home.</p>
    <NotesList v-else :groups="groups" :unsynced="unsynced" :states="states" @drop="setState($event, 'dropped')" @restore="setState($event, 'open')" />
    <p v-if="error" class="more" data-test="notes-error">{{ error }}</p>
    <p v-if="total > LIMIT" class="more">Showing the newest {{ LIMIT }} of {{ total }}.</p>
  </section>
</template>

<style scoped>
/* Not a scroll box: the page sheet scrolls. A box with overscroll containment and no height of its own never scrolls and
   swallows the gesture, so a Dashboard taller than the screen could not be scrolled over this card (S3a, 2026-10-11). */
.dialog { color: var(--glass-text); }
.head { display: flex; align-items: baseline; justify-content: space-between; }
.count { font-size: 0.75rem; color: var(--glass-sub); }
.empty, .more { font-size: 0.85rem; color: var(--glass-sub); margin-top: 0.75rem; }
</style>
