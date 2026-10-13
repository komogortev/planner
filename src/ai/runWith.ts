// Per-device state of model runs (H5-MODELS §5): which registered model this device runs with, and the call a run is
// waiting on. localStorage, like the pending run header (src/harness/pending.ts): synchronous, per device, ids only — never
// a prompt or a reply. Per device on purpose: a device runs with a model only after the owner chose it there, which is
// also what keeps a model run from being written before every device runs a build that accepts one (H5-MODELS §10 O5).
import { ref } from 'vue'

const MODEL_KEY = 'planner.run.model'
const CALL_KEY = { harness: 'planner.run.call.harness', widget: 'planner.run.call.widget' } as const

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
function readRunModel(): RunModel | null {
  const raw = read(MODEL_KEY)
  if (!raw) return null
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
export function setRunModel(m: RunModel | null): void {
  runModel.value = m
  write(MODEL_KEY, m ? JSON.stringify(m) : null)
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

/** Sign-out and account deletion wipe the account's data on this device (D-50): the model choice and waiting calls too. */
export function clearRunWith(): void {
  setRunModel(null)
  clearWaitingCall()
}
