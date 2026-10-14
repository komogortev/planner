<script setup lang="ts">
import { computed, ref } from 'vue'
import { REMOVAL_ANSWERS } from '@/domain/summary'
import { syncSoon } from '@/sync'
import type { Outcome } from './loop'
import { answer2, answerRemoval2, confirmProposal2, correctProposal2, dismiss2, rejectProposal2 } from './loop2'
import { proposalActions, proposalLabel, type StripItem } from './queue2'

// One item of the questions strip (D-70): the Task (or note) it is about, then the question with Answer · Skip — a removal
// question also gets Drop it · Keep it for later — or the proposal with buttons that name their outcome (Mark done · Keep
// open, …) and Correct…, whose text goes to the next run as an answer on the Task (owner, 2026-10-13). A reply is scope input: "these are two
// things" is a fine answer, and the next run reads it. Model and owner text are shown through interpolation only.
const props = defineProps<{ item: StripItem }>()
const emit = defineEmits<{ done: [] }>()
const text = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function act(fn: () => Promise<Outcome<number>>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const r = await fn()
    if (!r.ok) error.value = r.error
    else {
      text.value = ''
      syncSoon()
      emit('done')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
const question = computed(() => (props.item.kind === 'question' ? props.item.question : null))
const proposal = computed(() => (props.item.kind === 'proposal' ? props.item.proposal : null))
const label = computed(() => (props.item.kind === 'proposal' ? proposalLabel(props.item.proposal, props.item.tasks) : ''))
const onAnswer = () => {
  const q = question.value
  if (q && text.value.trim()) void act(() => answer2(q, text.value))
}
const onSkip = () => question.value && act(() => dismiss2(question.value!))
const onRemoval = (choice: 'drop' | 'keep') => question.value && act(() => answerRemoval2(question.value!, choice))
const onYes = () => proposal.value && act(() => confirmProposal2(proposal.value!))
const onNo = () => proposal.value && act(() => rejectProposal2(proposal.value!))
const actions = computed(() => (proposal.value ? proposalActions(proposal.value) : null))
const correcting = ref(false)
const onCorrect = () => {
  const p = proposal.value
  if (p && text.value.trim()) void act(() => correctProposal2(p, label.value, text.value))
}
</script>

<template>
  <div class="item" data-test="strip-item">
    <p class="about" :title="item.about" data-test="strip-about">
      <span class="tag">{{ item.kind === 'proposal' || item.task ? 'Task' : 'Note' }}</span> {{ item.about }}
    </p>
    <template v-if="item.kind === 'question'">
      <p class="ask" data-test="strip-question">{{ item.question.text }}</p>
      <div v-if="item.question.kind === 'removal'" class="flex gap-1.5 mt-1.5">
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="strip-removal-drop" @click="onRemoval('drop')">{{ REMOVAL_ANSWERS.drop }}</button>
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="strip-removal-keep" @click="onRemoval('keep')">{{ REMOVAL_ANSWERS.keep }}</button>
      </div>
      <div class="flex gap-1.5 mt-1.5">
        <input v-model="text" class="input in" :aria-label="`Answer: ${item.question.text}`" :placeholder="item.question.kind === 'removal' ? 'Or say something else' : 'Answer'" data-test="strip-answer" @keydown.enter="onAnswer" />
        <button type="button" class="btn-ghost btn-xs" :disabled="busy || !text.trim()" data-test="strip-answer-submit" @click="onAnswer">Answer</button>
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="strip-skip" @click="onSkip">Skip</button>
      </div>
    </template>
    <template v-else>
      <p class="ask" data-test="strip-proposal">{{ label }}</p>
      <div class="flex flex-wrap gap-1.5 mt-1.5">
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="strip-yes" @click="onYes">{{ actions?.yes }}</button>
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" data-test="strip-no" @click="onNo">{{ actions?.no }}</button>
        <button type="button" class="btn-ghost btn-xs" :disabled="busy" :aria-expanded="correcting" data-test="strip-correct" @click="correcting = !correcting">Correct…</button>
      </div>
      <div v-if="correcting" class="flex gap-1.5 mt-1.5">
        <input v-model="text" class="input in" :aria-label="`Correct: ${label}`" placeholder="What did it get wrong?" data-test="strip-correct-text" @keydown.enter="onCorrect" />
        <button type="button" class="btn-ghost btn-xs" :disabled="busy || !text.trim()" data-test="strip-correct-submit" @click="onCorrect">Send</button>
      </div>
      <p v-if="correcting" class="sub-hint">Sets this aside; the next run reads your correction.</p>
    </template>
    <p v-if="error" class="err" data-test="strip-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.about { font-size: 0.75rem; color: var(--glass-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: #a7f3d0; }
.ask { font-size: 0.9rem; margin-top: 0.15rem; overflow-wrap: anywhere; }
.in { padding: 0.3rem 0.6rem; font-size: 0.85rem; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
.sub-hint { font-size: 0.72rem; color: var(--glass-sub); margin-top: 0.25rem; }
.err { font-size: 0.75rem; color: var(--glass-err); margin-top: 0.25rem; }
</style>
