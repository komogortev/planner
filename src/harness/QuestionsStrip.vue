<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { syncSoon } from '@/sync'
import { applyHarnessReply2, pendingHarness2, startHarness2 } from './loop2'
import { runSummary2 } from './queue2'
import RunStep, { type Check } from './RunStep.vue'
import StripItemView from './StripItemView.vue'
import type { Loop2 } from './useLoop2'

// The questions strip (HW-HARNESS §11 Dashboard v2, D-70): one question or proposal at a time, under the Task it isolates;
// the list view shows them all. "Get feedback" is the harness run (copy-prompt, D-63): new notes and the Tasks changed since
// their last run ("N changes waiting for feedback", D-72 until an automatic run exists).
const props = defineProps<{ loop: Loop2 }>()
const items = computed(() => props.loop.items.value)
// The current item is followed by id, not position: a sync or a tap elsewhere reorders the queue, and the owner may be
// half-way through typing an answer. When it leaves (answered here or elsewhere), the item now at its place is next.
const currentId = ref<string | null>(null)
let lastIndex = 0
watch(
  items,
  (list) => {
    const at = list.findIndex((i) => i.id === currentId.value)
    if (at >= 0) lastIndex = at
    else currentId.value = list.length ? list[Math.min(lastIndex, list.length - 1)]!.id : null
  },
  { immediate: true },
)
const index = computed(() => Math.max(0, items.value.findIndex((i) => i.id === currentId.value)))
// With no current id (a store that changed no table, so `items` did not move), the first item shows: never "No open
// questions" over a non-empty count.
const current = computed(() => items.value.find((i) => i.id === currentId.value) ?? items.value[0] ?? null)
const expanded = ref(false)
const waiting = ref(pendingHarness2() !== null)
const feedback = ref(waiting.value)
const changes = computed(() => props.loop.work.value.notes + props.loop.work.value.tasks)
const changesLabel = computed(() => {
  const { notes, tasks } = props.loop.work.value
  const parts = [notes ? `${notes} new note${notes === 1 ? '' : 's'}` : '', tasks ? `${tasks} changed task${tasks === 1 ? '' : 's'}` : ''].filter(Boolean)
  return parts.join(' · ')
})

const next = () => {
  if (!items.value.length) return
  const to = (index.value + 1) % items.value.length
  lastIndex = to
  currentId.value = items.value[to]!.id
}

async function compose() {
  const out = await startHarness2()
  waiting.value = out !== null
  if (!out) return null
  const tasks = out.header.reevaluateIds.length
  const extra = [tasks ? `${tasks} changed task${tasks === 1 ? '' : 's'} go with them.` : '', out.header.remaining > 0 ? `${out.header.remaining} more notes wait for the next run.` : '']
  return { prompt: out.prompt, notes: out.header.toAssessIds.length + out.header.contextIds.length, note: extra.filter(Boolean).join(' ') || undefined }
}
async function check(reply: string): Promise<Check> {
  const r = await applyHarnessReply2(reply, { store: false })
  return r.ok ? { ok: true, lines: runSummary2(r.value.applied, r.value.header) } : r
}
async function store(reply: string) {
  const r = await applyHarnessReply2(reply, { store: true })
  if (!r.ok) return r
  waiting.value = false
  lastIndex = 0
  currentId.value = items.value[0]?.id ?? null // the new run's items lead (the watch moves it again when they land)
  syncSoon()
  const a = r.value.applied
  if (a.assessments.length === 0) return { ok: true as const, message: 'Nothing new was stored (a replay, or every row was dropped).' }
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return { ok: true as const, message: `Stored: ${n(a.tasks.length, 'task')} touched, ${n(a.questions.length, 'question')}, ${n(a.proposals.length, 'proposal')}.` }
}
</script>

<template>
  <section class="card strip" data-test="questions-strip" aria-label="Questions">
    <header class="flex items-center justify-between gap-2">
      <h3 class="font-semibold text-sm">
        Questions <span class="count" data-test="strip-count">{{ items.length }}</span>
      </h3>
      <div class="flex gap-1.5">
        <button v-if="expanded || items.length > 1" type="button" class="btn-ghost btn-xs" :aria-pressed="expanded" data-test="strip-expand" @click="expanded = !expanded">
          {{ expanded ? 'One at a time' : 'All' }}
        </button>
        <button type="button" class="btn-ghost btn-xs" :aria-pressed="feedback" data-test="strip-feedback" @click="feedback = !feedback">Get feedback</button>
      </div>
    </header>
    <p v-if="changes" class="waiting" data-test="strip-changes">{{ changes }} change{{ changes === 1 ? '' : 's' }} waiting for feedback · {{ changesLabel }}</p>

    <template v-if="!expanded">
      <div v-if="current" class="mt-2">
        <StripItemView :key="current.id" :item="current" />
        <div v-if="items.length > 1" class="flex items-center justify-between mt-1.5">
          <span class="sub">{{ index + 1 }} of {{ items.length }}</span>
          <button type="button" class="btn-ghost btn-xs" data-test="strip-next" @click="next">Next</button>
        </div>
      </div>
      <p v-else class="sub mt-1" data-test="strip-empty">No open questions.</p>
    </template>
    <div v-else class="list mt-2" data-test="strip-list">
      <StripItemView v-for="it in items" :key="it.id" :item="it" />
      <p v-if="!items.length" class="sub" data-test="strip-empty">No open questions.</p>
    </div>

    <div v-show="feedback" class="mt-2" data-test="strip-run">
      <RunStep title="Read my new notes and changed tasks" :waiting="waiting" :compose="compose" :check="check" :store="store" />
    </div>
  </section>
</template>

<style scoped>
.strip { color: var(--glass-text); }
.count { font-size: 0.75rem; color: var(--glass-sub); margin-left: 0.25rem; }
.waiting { font-size: 0.78rem; color: #fbbf24; margin-top: 0.3rem; }
.sub { font-size: 0.75rem; color: var(--glass-sub); }
.list { display: flex; flex-direction: column; gap: 0.75rem; max-height: 60dvh; overflow-y: auto; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
</style>
