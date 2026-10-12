<script setup lang="ts">
import { computed } from 'vue'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { marksByNote } from '@/harness/marks'
import { groupByDay } from './group'
import NotesList from './NotesList.vue'

// D-14a: the vertical slice's list is a frosted-glass dialog on the Dashboard — temporary, replaced by the notes
// widget. No search, filter, edit or delete. The newest 200 are shown; the rest stay in the database.
// Since S3 each note also shows what the harness asked about it and what it proposes (HW-HARNESS §3).
const LIMIT = 200
const entries = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().filter((e) => !e.deletedAt).limit(LIMIT).toArray(), [])
const queued = useLiveQuery(() => db.outbox.toArray().then((rows) => rows.map((r) => r.entityId)), [] as string[])
const total = useLiveQuery(() => db.entries.filter((e) => !e.deletedAt).count(), 0)
const marks = useLiveQuery(
  async () => marksByNote(await db.questions.toArray(), await db.links.where('state').equals('proposed').toArray(), await db.entryStates.toArray()),
  new Map(),
)
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
    <NotesList v-else :groups="groups" :unsynced="unsynced" :marks="marks" />
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
