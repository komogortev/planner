<script setup lang="ts">
import CardMenu from '@/widgets/CardMenu.vue'
import { cardTint } from '@/widgets/tints'
import { useWidgets } from '@/widgets/useWidgets'
import { computed, ref, watch } from 'vue'
import { isBodyTap } from '@/composables/bodyTap'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import type { EntryState } from '@/domain/harness'
import { markNote } from '@/harness/loop'
import { syncSoon } from '@/sync'
import { groupByDay, notesBrief, splitRemoved } from './group'
import NotesList from './NotesList.vue'

// D-14a: the vertical slice's list is a frosted-glass dialog on the Dashboard — temporary, replaced by the notes
// widget. No search, filter, edit or delete. The newest 200 are shown; the rest stay in the database.
// Since Dashboard v2 a note's questions are asked in the strip; here a note can only be dropped as junk, or brought back.
// Calibration 2026-10-12 (owner): brief by default like every widget — the count, the newest note, today's count; a tap
// on the body opens the list, a tap on the header closes it. Removed notes are not in the list: they sit behind a
// "Removed" line at its bottom, which opens them (with restore) on its own tap.
// `now` ticks (useLoop2): "N today" rolls over at midnight in a PWA left open overnight.
const props = defineProps<{ now: string }>()
const LIMIT = 200
const entries = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().filter((e) => !e.deletedAt).limit(LIMIT).toArray(), [])
const queued = useLiveQuery(() => db.outbox.toArray().then((rows) => rows.map((r) => r.entityId)), [] as string[])
const total = useLiveQuery(() => db.entries.filter((e) => !e.deletedAt).count(), 0)
const states = useLiveQuery(async () => new Map((await db.entryStates.toArray()).filter((s) => !s.deletedAt).map((s): [string, EntryState] => [s.id, s])), new Map<string, EntryState>())
// Removed notes across every live note, not only the newest LIMIT loaded: the count and the "Removed" line stay right.
const removedTotal = useLiveQuery(async () => {
  const closed = new Set((await db.entryStates.toArray()).filter((s) => !s.deletedAt && s.state !== 'open').map((s) => s.id))
  return closed.size ? db.entries.filter((e) => !e.deletedAt && closed.has(e.id)).count() : 0
}, 0)
const unsynced = computed(() => new Set(queued.value))
const error = ref<string | null>(null)
const open = ref(false)
const showRemoved = ref(false)
// A note dropped or restored while the list is open stays in the list it was in (struck through, or not) until the list
// closes: rows never move under a second tap, so a double tap on ✕ cannot drop the next note too.
const pinned = ref(new Map<string, 'kept' | 'removed'>())
// One write per note at a time: a double tap must not drop and then restore (the button changes under the finger).
const inFlight = new Set<string>()
async function setState(id: string, state: 'open' | 'dropped') {
  if (inFlight.has(id)) return
  inFlight.add(id)
  error.value = null
  if (!pinned.value.has(id)) pinned.value = new Map(pinned.value).set(id, state === 'dropped' ? 'kept' : 'removed')
  try {
    const r = await markNote(id, state)
    if (!r.ok) error.value = r.error
    else syncSoon()
  } finally {
    inFlight.delete(id)
  }
}
const split = computed(() => splitRemoved(entries.value, states.value, pinned.value))
const groups = computed(() => groupByDay(split.value.kept))
const removedGroups = computed(() => groupByDay(split.value.removed))
watch(open, (o) => {
  if (o) return
  pinned.value = new Map() // closing settles every row into its list
  showRemoved.value = false
})
watch(removedTotal, (n) => n === 0 && (showRemoved.value = false)) // the next removal starts folded
const count = computed(() => total.value - removedTotal.value)
const keptNow = computed(() => split.value.kept.filter((e) => (states.value.get(e.id)?.state ?? 'open') === 'open'))
const brief = computed(() => notesBrief(keptNow.value, props.now))
const unsyncedKept = computed(() => keptNow.value.filter((e) => unsynced.value.has(e.id)).length)
function onBody(e: MouseEvent) {
  if (!isBodyTap(e, '[data-test="notes-toggle"]') || total.value === 0) return
  if (!open.value) open.value = true
  else if ((e.target as Element).closest('[data-test="notes-head"]')) open.value = false
}
const { tintOf } = useWidgets() // C4: the card's tint
</script>

<template>
  <section class="card dialog" :class="{ 'tap-to-open': !open && total > 0 }" v-bind="cardTint(tintOf('system-notes'))" data-test="notes-dialog" :data-open="open" aria-label="Notes" @click="onBody">
    <header class="head" data-test="notes-head">
      <h3 class="font-semibold">
        <button type="button" class="toggle" :aria-expanded="open" :disabled="total === 0" data-test="notes-toggle">Notes</button>
      </h3>
      <span class="flex gap-1.5 items-center">
        <span class="count" data-test="notes-count">{{ count }}</span>
        <CardMenu widget-id="system-notes" label="Notes options" />
      </span>
    </header>
    <p v-if="total === 0" class="empty" data-test="notes-empty">Nothing captured yet. Write something on Home.</p>
    <template v-else>
      <div v-show="!open" class="brief" data-test="notes-brief">
        <p v-if="brief.latest !== null" class="latest">{{ brief.latest }}</p>
        <p class="sub">
          {{ brief.today }} today<span v-if="unsyncedKept"> · {{ unsyncedKept }} not synced yet</span><span v-if="removedTotal"> · {{ removedTotal }} removed</span>
        </p>
      </div>
      <div v-show="open" data-test="notes-full">
        <NotesList :groups="groups" :unsynced="unsynced" :states="states" @drop="setState($event, 'dropped')" @restore="setState($event, 'open')" />
        <p v-if="!split.kept.length" class="more">Every note is removed.</p>
        <button v-if="removedTotal" type="button" class="removed-line" :aria-expanded="showRemoved" data-test="notes-removed-toggle" @click="showRemoved = !showRemoved">
          Removed · {{ removedTotal }} <span aria-hidden="true">{{ showRemoved ? '▴' : '▾' }}</span>
        </button>
        <div v-if="showRemoved" data-test="notes-removed">
          <NotesList :groups="removedGroups" :unsynced="unsynced" :states="states" @drop="setState($event, 'dropped')" @restore="setState($event, 'open')" />
        </div>
      </div>
    </template>
    <p v-if="error" class="more" data-test="notes-error">{{ error }}</p>
    <p v-if="open && total > LIMIT" class="more">The newest {{ LIMIT }} of {{ total }} notes are loaded; older ones stay on the device.</p>
  </section>
</template>

<style scoped>
/* Not a scroll box: the page sheet scrolls. A box with overscroll containment and no height of its own never scrolls and
   swallows the gesture, so a Dashboard taller than the screen could not be scrolled over this card (S3a, 2026-10-11). */
.dialog { color: var(--glass-text); }
.head { display: flex; align-items: baseline; justify-content: space-between; }
.count { font-size: 0.75rem; color: var(--glass-sub); }
.tap-to-open { cursor: pointer; }
.toggle { background: none; color: inherit; font: inherit; padding: 0; } /* the title is the toggle (keyboard: Enter / Space) */
.brief .latest { margin-top: 0.5rem; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brief .sub { font-size: 0.75rem; color: var(--glass-sub); margin-top: 0.15rem; }
.removed-line { display: block; width: 100%; text-align: left; margin-top: 0.6rem; padding: 0.45rem 0 0.1rem; border-top: 1px solid var(--glass-edge); background: none; font-size: 0.75rem; color: var(--glass-sub); }
.empty, .more { font-size: 0.85rem; color: var(--glass-sub); margin-top: 0.75rem; }
</style>
