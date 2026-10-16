<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { awaitCall, listModels, markStored, ModelsError, outcomeText, startCall, type CallView } from '@/ai/models'
import { adoptAccountModel, clearEnded, clearWaitingCall, loadWaitingCall, markEnded, modelsKnown, runModel, runPath, saveWaitingCall, type ModelVia, type RunStage } from '@/ai/runWith'

// One run (D-35; H5): compose → the device's registered model answers through the Worker (`/ai/calls`, a Workflow: D-91)
// → check → store. Copy and paste is retired as a path (D-113): with no model the step says to add one. A reply that passes
// the check is stored at once and shows no JSON (D-103); one that fails shows the reason with the reply folded, and Store
// returns only when storing itself failed. The stage-specific work is passed in; this component only owns the steps. A run
// composed earlier (before the phone killed the app) still waits on its model call: `waiting` says so and the call is
// picked up on mount.
export type Check = { ok: true; lines: string[] } | { ok: false; error: string }
export type Composed = { prompt: string; notes: number; note?: string; runId: string }
const props = defineProps<{
  title: string
  stage: RunStage
  waiting: boolean
  /** The waiting run's id, to match a model call this device was waiting on. */
  waitingRunId?: string | null
  compose: () => Promise<Composed | null>
  /** What "nothing to send" means for this stage (compose returned null). */
  emptyText?: string
  check: (reply: string) => Promise<Check>
  store: (reply: string, via: ModelVia) => Promise<{ ok: true; message: string } | { ok: false; error: string }>
}>()
const emit = defineEmits<{ stored: [] }>()

const info = ref<string | null>(null)
const reply = ref('')
const preview = ref<string[] | null>(null)
const error = ref<string | null>(null)
const done = ref<string | null>(null)
const busy = ref(false)
/** A model call being waited on (its model's label for the status line, its run for "ended"). Never holds `busy`: the
 *  owner can stop waiting while it runs (CodeReview M1). */
const calling = ref<{ label: string; runId: string } | null>(null)
/** The call the reply came from: Store records it as a model run. */
const via = ref<ModelVia | null>(null)
let abort: AbortController | null = null
/** Model, or neither (D-113, alpha gap G1): with no model on this device a run is not offered; the step says to add one. */
const path = computed(() => runPath(runModel.value, modelsKnown.value))
/** Checking the account's models (`unknown`): Try again asks once more. */
const checking = ref(false)
async function retryModels(): Promise<void> {
  checking.value = true
  try {
    await adoptAccountModel(listModels)
  } finally {
    checking.value = false
  }
}
const router = useRouter()

/** Stop following a call (the call itself keeps running on the Worker). */
function stopFollow(): void {
  abort?.abort()
  abort = null
  calling.value = null
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (busy.value) return undefined
  busy.value = true
  try {
    return await fn()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return undefined
  } finally {
    busy.value = false
  }
}

async function runWithModel(): Promise<void> {
  const m = runModel.value
  if (!m) return
  error.value = done.value = null
  preview.value = null
  reply.value = ''
  via.value = null
  stopFollow()
  clearWaitingCall(props.stage)
  clearEnded(props.stage)
  const started = await run(async () => {
    const out = await props.compose()
    if (!out) {
      info.value = props.emptyText ?? 'Nothing to send: no note needs this step right now.'
      return null
    }
    const notes = `${out.notes} note${out.notes === 1 ? '' : 's'}`
    info.value = `Sending ${notes} to ${m.label}…`
    let callId: string
    try {
      callId = (await startCall({ modelId: m.id, stage: props.stage, runId: out.runId, prompt: out.prompt, entryCount: out.notes })).id
    } catch (err) {
      info.value = null // nothing left the device: do not say it did (CodeReview L4)
      error.value = err instanceof ModelsError ? err.message : String(err)
      return null
    }
    info.value = `${notes} went to ${m.label}.${out.note ? ` ${out.note}` : ''}`
    saveWaitingCall(props.stage, { callId, modelId: m.id, runId: out.runId })
    return { callId, runId: out.runId }
  })
  if (started) void follow(started.callId, m.id, m.label, started.runId)
}

/**
 * Waits for a call to finish, then checks the reply — or says why there is none. Outside `run()`: waiting holds no lock.
 * A newer follow, Stop waiting, a new run or leaving the page ends this one (its abort).
 */
async function follow(callId: string, modelId: string, label: string, runId: string): Promise<void> {
  stopFollow()
  const ac = new AbortController()
  abort = ac
  calling.value = { label, runId }
  let view: CallView
  try {
    view = await awaitCall(callId, { signal: ac.signal })
  } catch (err) {
    if (ac.signal.aborted) return // replaced or left: the call keeps running and is picked up on the next open
    error.value = err instanceof ModelsError ? `${err.message} The call may still finish: reopen to check.` : String(err)
    return
  } finally {
    if (abort === ac) { abort = null; calling.value = null }
  }
  if (ac.signal.aborted) return
  if (view.status !== 'ok' || view.reply === null) {
    clearWaitingCall(props.stage)
    markEnded(props.stage, runId) // nothing is coming back: the panel need not open for this run again
    error.value = view.replyCleared ? 'This reply was already used or has expired. Run again.' : outcomeText(view.status)
    return
  }
  reply.value = view.reply
  via.value = { modelId, callId }
  await checkReply()
  // A model run stores its own result (D-103): only a reply that fails the check waits, with the reason.
  if (preview.value && via.value?.callId === callId) await storeReply()
}

/** The owner stops waiting: the call may still finish on the Worker, but this run no longer expects it. */
function stopWaiting(): void {
  const runId = calling.value?.runId
  stopFollow()
  clearWaitingCall(props.stage)
  if (runId) markEnded(props.stage, runId)
  info.value = 'Stopped waiting. Run again when you like.'
}

onMounted(() => {
  void adoptAccountModel(listModels) // a device that never chose offers the account's model (D-102)
  const w = loadWaitingCall(props.stage)
  if (!w) return
  if (!props.waiting || w.runId !== props.waitingRunId) {
    clearWaitingCall(props.stage) // the run it belonged to is gone (stored, or replaced by a new run)
    return
  }
  void follow(w.callId, w.modelId, runModel.value?.id === w.modelId ? runModel.value.label : 'your model', w.runId)
})
onBeforeUnmount(() => abort?.abort())

/**
 * Start a run the way the button does. A run already under way (a model working, a reply waiting to be stored) is left
 * alone: a second Refresh shows it instead of replacing it and sending a second call (CodeReview B1).
 */
defineExpose({
  go: async () => {
    if (calling.value || busy.value || reply.value.trim()) return
    await adoptAccountModel(listModels) // a Refresh right after the page opened waits for the model
    if (calling.value || busy.value || reply.value.trim()) return
    if (path.value !== 'model') return // the step says why; nothing is composed
    return runWithModel()
  },
})

async function checkReply(): Promise<void> {
  error.value = done.value = null
  await run(async () => {
    const r = await props.check(reply.value)
    if (r.ok) preview.value = r.lines
    else {
      preview.value = null
      error.value = r.error
    }
  })
}

async function storeReply(): Promise<void> {
  const used = via.value
  if (!used) return
  error.value = null
  await run(async () => {
    const r = await props.store(reply.value, used)
    if (!r.ok) {
      error.value = r.error
      return
    }
    clearWaitingCall(props.stage)
    via.value = null
    void markStored(used.callId).catch(() => {}) // best effort: the Worker clears the reply after 7 days anyway
    done.value = r.message
    reply.value = ''
    preview.value = null
    info.value = null
    emit('stored')
  })
}
</script>

<template>
  <section class="step" :data-test="`run-step`">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="font-semibold text-sm">{{ title }}</h4>
      <div class="flex gap-2">
        <button v-if="calling" type="button" class="btn-ghost btn-sm whitespace-nowrap" data-test="run-stop" @click="stopWaiting">Stop waiting</button>
        <button v-else-if="runModel" type="button" class="btn-primary btn-sm whitespace-nowrap" :disabled="busy" data-test="run-model" @click="runWithModel">
          Run with {{ runModel.label }}
        </button>
        <button v-else-if="path === 'needs-model'" type="button" class="btn-primary btn-sm whitespace-nowrap" data-test="run-add-model" @click="router.push('/settings')">
          Add a model
        </button>
        <button v-else-if="path === 'unknown'" type="button" class="btn-ghost btn-sm whitespace-nowrap" :disabled="checking" data-test="run-retry-models" @click="retryModels">
          Try again
        </button>
      </div>
    </header>
    <!-- Always in the page, so a screen reader announces the change rather than meeting a region that arrives full. -->
    <p class="sub" :class="{ 'sr-only': !calling }" role="status" data-test="run-calling">{{ calling ? `${calling.label} is working on it — this can take a minute. You can leave this page; the answer waits for you.` : '' }}</p>
    <p v-if="path === 'needs-model' && !calling" class="sub" data-test="run-needs-model">
      Feedback runs with your own AI model. Add one in Settings → AI models; until then your notes are kept and synced as usual.
    </p>
    <p v-if="path === 'unknown' && !calling" class="sub" data-test="run-models-unknown">
      {{ checking ? 'Looking for your AI model…' : 'Could not check for your AI model. Feedback needs a connection; try again when online.' }}
    </p>
    <p v-if="info" class="sub" data-test="run-info">{{ info }}</p>
    <!-- A model run shows no JSON (D-103): its reply appears, folded, only when it failed the check, next to the reason;
         Store stays for a retry when storing itself failed. -->
    <template v-if="via && !calling">
      <details v-if="!preview && reply" class="mt-2" data-test="run-model-reply">
        <summary class="sub cursor-pointer">Show the model's reply</summary>
        <textarea class="input mt-1 text-xs" rows="6" readonly :value="reply" />
      </details>
      <button v-if="preview" type="button" class="btn-primary btn-sm mt-2" :disabled="busy" data-test="run-store" @click="storeReply">Store</button>
    </template>
    <ul v-if="preview" class="preview" data-test="run-preview">
      <li v-for="(l, i) in preview" :key="i">{{ l }}</li>
    </ul>
    <p v-if="error" class="err" data-test="run-error">{{ error }}</p>
    <p v-if="done" class="sub" data-test="run-done">{{ done }}</p>
  </section>
</template>

<style scoped>
.step { padding: 0.6rem 0; border-top: 1px solid var(--glass-edge); }
.sub { font-size: 0.78rem; color: var(--glass-sub); margin-top: 0.35rem; }
.err { font-size: 0.8rem; color: var(--glass-err); margin-top: 0.35rem; }
.preview { font-size: 0.8rem; margin-top: 0.5rem; padding-left: 1rem; list-style: disc; color: var(--glass-text); }
.btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; }
</style>
