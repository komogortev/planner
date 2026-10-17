// Per-device state of model runs (H5-MODELS §5): which registered model this device runs with, and the call a run is
// waiting on. localStorage, like the pending run header (src/harness/pending.ts): synchronous, per device, ids only — never
// a prompt or a reply. Per device: a device can run with a different model. A device that never chose follows the account
// default, then the first usable model (D-102, D-126). Copy and paste is retired as a path (D-113).
import { ref } from 'vue'
import { clearPending, pendingRun } from '@/harness/pending'

const MODEL_KEY = 'planner.run.model'
const CALL_KEY = { harness: 'planner.run.call.harness', widget: 'planner.run.call.widget' } as const
const ENDED_KEY = { harness: 'planner.run.ended.harness', widget: 'planner.run.ended.widget' } as const

export type RunStage = keyof typeof CALL_KEY
export interface WaitingCall { callId: string; modelId: string; runId: string }
/** How a stored run's reply arrived when a registered model produced it: recorded on the run (`executor: 'model'`). */
export interface ModelVia { modelId: string; callId: string }
/** The run record's executor fields: a model run names its model and call (records.ts rule). Rows from before D-113 may
 *  still say `copy-prompt`; the shared validator keeps reading them, nothing writes one. */
export const executorFields = (via: ModelVia) => ({ executor: 'model' as const, modelId: via.modelId, callId: via.callId })

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
    // blocked storage: the choice is not remembered; the account's model is adopted again on the next load
  }
}

export interface RunModel { id: string; label: string }
/** What a device that picked "Copy and paste" stored before D-113. Read once and removed, so the device adopts the account's
 *  model like one that never chose (`adoptAccountModel` asks only while nothing is stored). */
const RETIRED_MANUAL = 'manual'
function readRunModel(): RunModel | null {
  const raw = read(MODEL_KEY)
  if (raw === RETIRED_MANUAL) write(MODEL_KEY, null)
  if (!raw || raw === RETIRED_MANUAL) return null
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    return typeof m.id === 'string' && typeof m.label === 'string' ? { id: m.id, label: m.label } : null
  } catch {
    return null
  }
}

/** The model this device runs with (its label kept for the Run button), or null when none is chosen yet. Reactive: Settings
 *  and the run panel share it. */
export const runModel = ref<RunModel | null>(readRunModel())
/** The owner's choice on this device, remembered. */
export function setRunModel(m: RunModel): void {
  runModel.value = m
  write(MODEL_KEY, JSON.stringify(m))
}
/** No choice on this device: it follows the account (`reconcileRunModel`). Also the remove path for the chosen model. */
export function unsetRunModel(): void {
  runModel.value = null
  write(MODEL_KEY, null)
}

/** The account's models were read on this page load (by the run panel or by Settings): only then does "no model" mean
 *  the account has none, rather than a device that has not asked yet or could not (offline, a failed request). */
export const modelsKnown = ref(false)

/** How a run starts on this device. `unknown`: no model chosen here and the account's models not read yet. */
export type RunPath = 'model' | 'needs-model' | 'unknown'
/** The run path (D-113): with a model, the model; without one, the step says to add a model (or that it could not check). */
export function runPath(model: RunModel | null, known: boolean): RunPath {
  if (model) return 'model'
  return known ? 'needs-model' : 'unknown'
}

/**
 * Lines this device's choice up with the account's models (D-102). A chosen model that is gone, or lost its key, is
 * unset. A device that never chose follows the account default; if none is set, it uses the oldest model with a key. A
 * model added on the desktop is offered on the phone too, and in the home-screen app, which keeps its own storage. This holds for several
 * models too (D-113: the model is on by default).
 */
export function reconcileRunModel(models: readonly { id: string; label: string; hasKey: boolean; isDefault?: boolean }[]): void {
  const usable = models.filter((m) => m.hasKey)
  modelsKnown.value = true
  const cur = runModel.value
  const still = cur && usable.find((m) => m.id === cur.id)
  if (cur && !still) unsetRunModel()
  else if (still) {
    if (still.label !== cur!.label) setRunModel({ id: still.id, label: still.label })
    return
  }
  const fallback = usable.find((m) => m.isDefault) ?? usable[0]
  if (fallback) setRunModel({ id: fallback.id, label: fallback.label })
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
export function adoptAccountModel(list: () => Promise<readonly { id: string; label: string; hasKey: boolean; isDefault?: boolean }[]>): Promise<void> {
  // A usable choice stops the ask, not any stored value: a 'manual' written back by an older build in another window, or a
  // value that does not parse, must not leave Try again doing nothing (CodeReview R4-2).
  if (asked || runModel.value !== null) return Promise.resolve()
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
 * Whether a waiting run should open its panel on arrival: yes while its model call may still answer, unless the call for
 * this very run already ended without a reply, when nothing is coming back and an open panel is only in the way.
 */
export function opensOnArrival(stage: RunStage, waitingRunId: string | null): boolean {
  if (waitingRunId === null) return false
  return read(ENDED_KEY[stage]) !== waitingRunId
}

/**
 * A composed run is worth keeping only while a model call for it may still answer (D-113: no reply can be pasted any more).
 * Run once at start-up, before any panel reads its header: a header with no waiting call for its run (a copied prompt from
 * before D-113, a compose whose call never started, a call that ended) is cleared, so no panel shows a run that cannot
 * finish. A header composed in the last `STARTING_MS` is kept even without its call: another window may be between saving it
 * and saving the call that `startCall` returns (CodeReview R4-1). Returns the stages cleared.
 */
export const STARTING_MS = 120_000
export function dropStrandedRuns(now: number = Date.now()): RunStage[] {
  const dropped: RunStage[] = []
  for (const stage of Object.keys(CALL_KEY) as RunStage[]) {
    const run = pendingRun(stage)
    if (run === null) continue
    const runId = run.runId
    const call = loadWaitingCall(stage)
    if (call?.runId === runId && read(ENDED_KEY[stage]) !== runId) continue
    const composed = run.composedAt === null ? NaN : Date.parse(run.composedAt)
    if (!call && composed <= now && now - composed < STARTING_MS) continue
    clearPending(stage)
    dropped.push(stage)
  }
  return dropped
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
