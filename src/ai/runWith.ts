// Per-device state of model runs (H5-MODELS §5): which registered model this device runs with, and the call a run is
// waiting on. localStorage, like the pending run header (src/harness/pending.ts): synchronous, per device, ids only — never
// a prompt or a reply. Per device: a device can run with a different model, or with copy and paste. A device that never
// chose follows the account's only model (D-102), which lifted the per-device O5 gate (H5-MODELS §10): every device the
// owner uses already ran the build that accepts a model run.
import { ref } from 'vue'

const MODEL_KEY = 'planner.run.model'
const CALL_KEY = { harness: 'planner.run.call.harness', widget: 'planner.run.call.widget' } as const
const ENDED_KEY = { harness: 'planner.run.ended.harness', widget: 'planner.run.ended.widget' } as const

export type RunStage = keyof typeof CALL_KEY
export interface WaitingCall { callId: string; modelId: string; runId: string }
/** How a stored run's reply arrived when a registered model produced it: recorded on the run (`executor: 'model'`). */
export interface ModelVia { modelId: string; callId: string }
/** The run record's executor fields: a paste leaves the H5 keys out, a model run names both (records.ts rule). */
export const executorFields = (via?: ModelVia) =>
  via ? { executor: 'model' as const, modelId: via.modelId, callId: via.callId } : { executor: 'copy-prompt' as const }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // blocked storage: the choice is not remembered, runs fall back to copy and paste
  }
}

export interface RunModel { id: string; label: string }
/** Stored when the owner picks "Copy and paste" on this device: an explicit choice, unlike no value at all (D-102). */
const MANUAL = 'manual'
function readRunModel(): RunModel | null {
  const raw = read(MODEL_KEY)
  if (!raw || raw === MANUAL) return null
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    return typeof m.id === 'string' && typeof m.label === 'string' ? { id: m.id, label: m.label } : null
  } catch {
    return null
  }
}

/** The model this device runs with (its label kept for the Run button), or null for copy and paste. Reactive: Settings and
 *  the run panel share it. */
export const runModel = ref<RunModel | null>(readRunModel())
/** "Copy and paste" was picked on this device (Settings): the only way a run without a model offers the paste path. */
export const pasteChosen = ref(read(MODEL_KEY) === MANUAL)
/** The owner's choice on this device: a model, or null for "Copy and paste". Either one is remembered as chosen. */
export function setRunModel(m: RunModel | null): void {
  runModel.value = m
  pasteChosen.value = m === null
  write(MODEL_KEY, m ? JSON.stringify(m) : MANUAL)
}
/** No choice on this device: it follows the account (`reconcileRunModel`). Also the remove path for the chosen model. */
export function unsetRunModel(): void {
  runModel.value = null
  pasteChosen.value = false
  write(MODEL_KEY, null)
}

/** The account's models were read on this page load (by the run panel or by Settings): only then does "no model" mean
 *  the account has none, rather than a device that has not asked yet or could not (offline, a failed request). */
export const modelsKnown = ref(false)

/** How a run starts on this device. `unknown`: no model chosen here and the account's models not read yet. */
export type RunPath = 'model' | 'paste' | 'needs-model' | 'unknown'
/**
 * The run path (D-113, alpha gap G1): with a model, the model. Without one, copy and paste only where it was picked on
 * this device ("Copy and paste" in Settings, offered only once the account has a model) or where a pasted run is already
 * waiting for its reply — so an account with no model (an invitee without a key) never meets the paste path; it is told
 * to add a model instead.
 */
export function runPath(model: RunModel | null, chosePaste: boolean, waiting: boolean, known: boolean): RunPath {
  if (model) return 'model'
  if (chosePaste || waiting) return 'paste'
  return known ? 'needs-model' : 'unknown'
}

/**
 * Lines this device's choice up with the account's models (D-102). A chosen model that is gone, or lost its key, is
 * unset. A device that never chose runs with the account's first model that has a key (the oldest): a model added on
 * the desktop is offered on the phone too, and in the home-screen app, which keeps its own storage. Since D-113 (copy and
 * paste retired as a path) this holds for several models too (owner, 2026-10-13: the model is on by default; before, several
 * models meant copy and paste until a pick). "Copy and paste" picked here is left alone.
 */
export function reconcileRunModel(models: readonly { id: string; label: string; hasKey: boolean }[]): void {
  const usable = models.filter((m) => m.hasKey)
  modelsKnown.value = true
  if (read(MODEL_KEY) === MANUAL) return
  const cur = runModel.value
  const still = cur && usable.find((m) => m.id === cur.id)
  if (cur && !still) unsetRunModel()
  else if (still) {
    if (still.label !== cur!.label) setRunModel({ id: still.id, label: still.label })
    return
  }
  if (usable.length > 0) setRunModel({ id: usable[0].id, label: usable[0].label })
}

let adopting: Promise<void> | null = null
/** Asked once per page load: with no model that has a key nothing is stored, and each panel must not ask again. */
let asked = false
/** Bumped by sign-out: an answer that arrives after it belongs to the account that left. */
let generation = 0
/**
 * The run panel's half of D-102: a device with no choice asks the account for its models once (one request even when two
 * panels mount together). Resolves once `runModel` is settled. Failure (offline, signed out) leaves the models unknown
 * (`modelsKnown` false): the panel says it could not check, and the next panel or Try again asks again.
 */
export function adoptAccountModel(list: () => Promise<readonly { id: string; label: string; hasKey: boolean }[]>): Promise<void> {
  if (asked || read(MODEL_KEY) !== null) return Promise.resolve()
  const gen = generation
  adopting ??= list()
    .then((models) => {
      if (gen !== generation) return
      asked = true
      reconcileRunModel(models)
    }, () => {}) // offline or signed out: ask again on the next panel
    .finally(() => { adopting = null })
  return adopting
}

export function saveWaitingCall(stage: RunStage, c: WaitingCall): void {
  write(CALL_KEY[stage], JSON.stringify(c))
}
/** The call a stage's run waits on, or null. A malformed value is ignored, never trusted. */
export function loadWaitingCall(stage: RunStage): WaitingCall | null {
  const raw = read(CALL_KEY[stage])
  if (!raw) return null
  try {
    const c = JSON.parse(raw) as Record<string, unknown>
    return typeof c.callId === 'string' && typeof c.modelId === 'string' && typeof c.runId === 'string' ? (c as unknown as WaitingCall) : null
  } catch {
    return null
  }
}
export function clearWaitingCall(stage?: RunStage): void {
  for (const s of stage ? [stage] : (Object.keys(CALL_KEY) as RunStage[])) write(CALL_KEY[s], null)
}

/** A model call for this run ended without a reply (or the owner stopped waiting): nothing is coming back for it. */
export function markEnded(stage: RunStage, runId: string): void {
  write(ENDED_KEY[stage], runId)
}
export function clearEnded(stage?: RunStage): void {
  for (const s of stage ? [stage] : (Object.keys(ENDED_KEY) as RunStage[])) write(ENDED_KEY[s], null)
}

/**
 * Whether a waiting run should open its panel on arrival: yes — the owner is coming back with a reply to paste
 * (calibration 2026-10-12), or a model call for it is still running — unless a model call for this very run already ended
 * without a reply, when nothing is coming back and an open panel is only in the way.
 */
export function opensOnArrival(stage: RunStage, waitingRunId: string | null): boolean {
  if (waitingRunId === null) return false
  return read(ENDED_KEY[stage]) !== waitingRunId
}

/** Sign-out and account deletion wipe the account's data on this device (D-50): the model choice and waiting calls too. */
export function clearRunWith(): void {
  generation++
  asked = false
  modelsKnown.value = false
  unsetRunModel()
  clearWaitingCall()
  clearEnded()
}
