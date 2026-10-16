// A composed run waiting for its model's reply (HW-HARNESS §3, §4; H5). The reply is validated against what the prompt
// actually sent (`RunHeader2` / `JournalHeader`), so the header must outlive the call: a phone kills a backgrounded PWA
// (D-56) and a deploy reloads it. localStorage, like the capture draft: synchronous and per device. The header holds ids and
// times only, never note text. It is cleared with the account's tables (`clearAccountData`), and at start-up when no model
// call for it is waiting (`dropStrandedRuns`, D-113).
import { HARNESS_V2, type RunHeader2 } from '@/domain/harness2'
import type { JournalHeader } from '@/domain/journal'

export type PendingStage = 'harness' | 'widget'

const KEY: Record<PendingStage, string> = {
  harness: 'planner.run.pending.harness',
  widget: 'planner.run.pending.widget',
}

export function savePending<S extends PendingStage>(stage: S, header: S extends 'harness' ? RunHeader2 : JournalHeader): boolean {
  try {
    localStorage.setItem(KEY[stage], JSON.stringify(header))
    return true
  } catch {
    return false
  }
}

const isIdList = (l: unknown) => Array.isArray(l) && l.every((x) => typeof x === 'string')

function readRaw(stage: PendingStage): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(KEY[stage])
    if (!raw) return null
    const h = JSON.parse(raw) as unknown
    return typeof h === 'object' && h !== null ? (h as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The run id of whatever the stage's slot holds (any version or shape), or null: what `dropStrandedRuns` matches calls to. */
export function pendingRunId(stage: PendingStage): string | null {
  return pendingRun(stage)?.runId ?? null
}

/** The run id and compose time of whatever the slot holds; `composedAt` is null when the stored value has none. */
export function pendingRun(stage: PendingStage): { runId: string; composedAt: string | null } | null {
  const h = readRaw(stage)
  if (!h || typeof h.runId !== 'string') return null
  return { runId: h.runId, composedAt: typeof h.composedAt === 'string' ? h.composedAt : null }
}

/** The waiting widget header, or null. A stored value of the wrong stage or shape is ignored, never trusted. */
export function loadPending(stage: 'widget'): JournalHeader | null {
  const h = readRaw(stage)
  if (h?.stage !== stage || typeof h.runId !== 'string' || typeof h.composedAt !== 'string') return null
  if (!isIdList(h.entryIds)) return null
  return h as unknown as JournalHeader
}

/** The waiting harness v2 header, or null (none, malformed, or a header from harness v1). */
export function loadPending2(): RunHeader2 | null {
  const h = readRaw('harness')
  if (h?.stage !== 'harness' || h.harnessVersion !== HARNESS_V2 || typeof h.runId !== 'string' || typeof h.composedAt !== 'string') return null
  if (![h.toAssessIds, h.contextIds, h.reevaluateIds, h.taskIds].every(isIdList)) return null
  return h as unknown as RunHeader2
}

export function clearPending(stage?: PendingStage): void {
  for (const s of stage ? [stage] : (Object.keys(KEY) as PendingStage[])) {
    try {
      localStorage.removeItem(KEY[s])
    } catch {
      // blocked storage: nothing was stored either
    }
  }
}
