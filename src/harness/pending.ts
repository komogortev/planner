// A composed run waiting for its pasted reply (HW-HARNESS §3, §4). The reply is validated against what the prompt actually
// sent (`RunScope` / `JournalHeader`), so the header must outlive the trip to the AI app: a phone kills a backgrounded PWA
// (D-56) and a deploy reloads it. localStorage, like the capture draft: synchronous and per device. The header holds ids and
// times only, never note text. It is cleared with the account's tables (`clearAccountData`).
import type { RunHeader } from '@/domain/harness'
import { HARNESS_V2, type RunHeader2 } from '@/domain/harness2'
import type { JournalHeader } from '@/domain/journal'

export type PendingStage = 'harness' | 'widget'
type HeaderOf<S extends PendingStage> = S extends 'harness' ? RunHeader : JournalHeader

const KEY: Record<PendingStage, string> = {
  harness: 'planner.run.pending.harness',
  widget: 'planner.run.pending.widget',
}

// One slot per stage: harness v1 and v2 share it, so composing either replaces the other, and each loader takes only its own
// version (a header from the other version is ignored, never checked against the wrong rules).
export function savePending<S extends PendingStage>(stage: S, header: S extends 'harness' ? RunHeader | RunHeader2 : JournalHeader): boolean {
  try {
    localStorage.setItem(KEY[stage], JSON.stringify(header))
    return true
  } catch {
    return false
  }
}

/** The waiting header, or null. A stored value of the wrong stage or shape is ignored, never trusted. */
export function loadPending<S extends PendingStage>(stage: S): HeaderOf<S> | null {
  try {
    const raw = localStorage.getItem(KEY[stage])
    if (!raw) return null
    const h = JSON.parse(raw) as Record<string, unknown> | null
    if (h?.stage !== stage || typeof h.runId !== 'string' || typeof h.composedAt !== 'string') return null
    if (stage === 'harness' && h.harnessVersion === HARNESS_V2) return null
    const lists = stage === 'harness' ? [h.toAssessIds, h.contextIds] : [h.entryIds]
    if (!lists.every(isIdList)) return null
    return h as unknown as HeaderOf<S>
  } catch {
    return null
  }
}

const isIdList = (l: unknown) => Array.isArray(l) && l.every((x) => typeof x === 'string')

/** The waiting harness v2 header, or null (none, malformed, or one composed by harness v1). */
export function loadPending2(): RunHeader2 | null {
  try {
    const raw = localStorage.getItem(KEY.harness)
    if (!raw) return null
    const h = JSON.parse(raw) as Record<string, unknown> | null
    if (h?.stage !== 'harness' || h.harnessVersion !== HARNESS_V2 || typeof h.runId !== 'string' || typeof h.composedAt !== 'string') return null
    if (![h.toAssessIds, h.contextIds, h.reevaluateIds, h.taskIds].every(isIdList)) return null
    return h as unknown as RunHeader2
  } catch {
    return null
  }
}

/** True when the harness slot holds a header of another version: the reply the owner has is for a prompt this build cannot check. */
export function pendingIsOtherVersion(): boolean {
  try {
    const raw = localStorage.getItem(KEY.harness)
    return raw !== null && loadPending2() === null && loadPending('harness') !== null
  } catch {
    return false
  }
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
