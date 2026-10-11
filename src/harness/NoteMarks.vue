<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { EntryState, Link, Question } from '@/domain/harness'
import { syncSoon } from '@/sync'
import { answer, confirm, dismiss, markNote, reject, type Outcome } from './loop'

// What the harness marked on one note (HW-HARNESS §3): its open questions (answer or dismiss) and the proposals about it
// (confirm or reject — only the owner's tap changes a note's state). Model text is shown through interpolation only.
// A carried note also gets the owner's own pick-up day (D-66): the lead-time question's answer lands here, because the
// harness cannot propose a second carry for the same note (a pair is proposed once). The owner's date outranks a proposal.
const props = defineProps<{ entryId: string; questions: Question[]; proposals: Link[]; state: EntryState | null; answered: number }>()

const drafts = reactive<Record<string, string>>({})
const error = ref<string | null>(null)
const busy = ref(false)

async function act(fn: () => Promise<Outcome<number>>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const r = await fn()
    if (!r.ok) error.value = r.error
    else syncSoon()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
const onAnswer = (q: Question) => act(() => answer(q, drafts[q.id] ?? ''))
const pickUp = ref(props.state?.followUpOn ?? '')
// The row stays mounted while its marks change (a confirm, a sync): the field follows the stored date, never a stale one.
watch(() => props.state?.followUpOn, (v) => (pickUp.value = v ?? ''))
const onPickUp = () => act(() => markNote(props.entryId, 'open', pickUp.value))
</script>

<template>
  <div class="marks" data-test="note-marks">
    <p v-if="state && state.state !== 'open'" class="badge" data-test="note-state">{{ state.state }}</p>
    <div v-else-if="state?.followUpOn" class="flex flex-wrap items-center gap-1.5">
      <p class="badge" data-test="note-state">carried to {{ state.followUpOn }}</p>
      <input v-model="pickUp" type="date" class="input q-in w-auto" aria-label="Pick up on" data-test="note-pickup" />
      <button type="button" class="btn-ghost btn-xs" :disabled="busy || !pickUp || pickUp === state.followUpOn" data-test="note-pickup-set" @click="onPickUp">Set</button>
    </div>

    <div v-for="q in questions" :key="q.id" class="q" data-test="note-question">
      <p class="q-text">? {{ q.text }}</p>
      <div class="flex gap-1.5 mt-1">
        <input v-model="drafts[q.id]" class="input q-in" :aria-label="`Answer: ${q.text}`" placeholder="Answer" data-test="question-answer" @keydown.enter="onAnswer(q)" />
        <button type="button" class="btn-ghost btn-xs" :disabled="busy || !(drafts[q.id] ?? '').trim()" data-test="question-submit" @click="onAnswer(q)">Answer</button>
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="question-dismiss" @click="act(() => dismiss(q))">Skip</button>
      </div>
    </div>

    <div v-for="l in proposals" :key="l.id" class="q" data-test="note-proposal">
      <p class="q-text">
        <template v-if="l.kind === 'closes'">Done? A later note says: “{{ l.evidence }}”</template>
        <template v-else>Carry to {{ l.onDate }}?</template>
      </p>
      <div class="flex gap-1.5 mt-1">
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="proposal-confirm" @click="act(() => confirm(l))">Yes</button>
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="proposal-reject" @click="act(() => reject(l))">No</button>
      </div>
    </div>

    <p v-if="answered" class="sub">{{ answered }} answered</p>
    <p v-if="error" class="err">{{ error }}</p>
  </div>
</template>

<style scoped>
.marks { grid-column: 2 / -1; display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.15rem; }
.badge { white-space: nowrap; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: #a7f3d0; }
.q { background: var(--glass-pool); border-radius: 0.6rem; padding: 0.4rem 0.55rem; }
.q-text { font-size: 0.82rem; overflow-wrap: anywhere; }
.q-in { padding: 0.25rem 0.6rem; font-size: 0.8rem; }
.btn-xs { padding: 0.25rem 0.6rem; font-size: 0.75rem; border-radius: 0.6rem; }
.sub { font-size: 0.72rem; color: var(--glass-sub); }
.err { font-size: 0.75rem; color: #fda4af; }
</style>
