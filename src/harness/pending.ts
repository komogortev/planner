// A composed run waiting for its pasted reply (HW-HARNESS §3, §4). The reply is validated against what the prompt actually
// sent (`RunScope` / `JournalHeader`), so the header must outlive the trip to the AI app: a phone kills a backgrounded PWA
// (D-56) and a deploy reloads it. localStorage, like the capture draft: synchronous and per device. The header holds ids and
// times only, never note text. It is cleared with the account's tables (`clearAccountData`).
import type { RunHeader } from '@/domain/harness'
import type { JournalHeader } from '@/domain/journal'

export type PendingStage = 'harness' | 'widget'
type HeaderOf<S extends PendingStage> = S extends 'harness' ? RunHeader : JournalHeader

const KEY: Record<PendingStage, string> = {
  harness: 'planner.run.pending.harness',
  widget: 'planner.run.pending.widget',
}

export function savePending<S extends PendingStage>(stage: S, header: HeaderOf<S>): boolean {
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
    const lists = stage === 'harness' ? [h.toAssessIds, h.contextIds] : [h.entryIds]
    if (!lists.every((l) => Array.isArray(l) && l.every((x) => typeof x === 'string'))) return null
    return h as unknown as HeaderOf<S>
  } catch {
    return null
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
