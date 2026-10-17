// A schedule's run, device side (H5-S3-SCHEDULES D-123, D-124, D-134, D-135). The Worker composed the run and called the model
// while the app was closed; here the first device to open checks the reply and stores it through the path a manual run uses
// (`applyHarnessReply2`), then tells the Worker it is stored. No model wait: the reply is already there.
import { listModels, markStored } from '@/ai/models'
import { listSchedules, listWaiting, saveMorning } from '@/ai/schedules'
import { storedToken } from '@/auth/signIn'
import { clearPending, pendingRun, savePending } from './pending'
import { applyHarnessReply2 } from './loop2'
import { deviceZone } from './loop'

/** D-124: Morning is on by default at 06:00 once a model with a key exists. */
export const DEFAULT_MORNING_HOUR = 6

/**
 * Create the Morning schedule when the account has none and has a usable model (D-124), and follow this device's zone when it
 * differs from the saved one (D-134). An account that turned the schedule off keeps it off: only a missing row is created.
 */
export async function ensureMorning(): Promise<void> {
  const { schedules } = await listSchedules()
  const cur = schedules.find((s) => s.kind === 'morning')
  const zone = deviceZone()
  if (cur) {
    if (cur.zone !== zone) await saveMorning({ zone })
    return
  }
  if ((await listModels()).some((m) => m.hasKey)) await saveMorning({ hour: DEFAULT_MORNING_HOUR, zone, enabled: true })
}

/**
 * Store every waiting scheduled reply, oldest first (D-135). Stops at a run this device itself is waiting on, so a manual run
 * is never overwritten. Returns how many were stored. Never throws: a failed read is the next open's problem.
 */
async function applyAll(): Promise<number> {
  if (!storedToken()) return 0
  let waiting
  try {
    await ensureMorning().catch(() => undefined)
    waiting = await listWaiting()
  } catch {
    return 0
  }
  let stored = 0
  for (const w of waiting) {
    if (pendingRun('harness') !== null) break
    if (!savePending('harness', w.header)) break
    const r = await applyHarnessReply2(w.reply, { store: true, via: { modelId: w.modelId, callId: w.callId } })
    if (!r.ok) { clearPending('harness'); break }
    try { await markStored(w.callId) } catch { /* stored here; the Worker keeps the reply until its 7 days, and a second apply is a no-op (L6) */ }
    stored++
  }
  return stored
}

let running: Promise<number> | null = null
/** One pass at a time: the sync engine reports idle often, and two passes would race for the one pending slot. */
export const applyWaitingSchedules = (): Promise<number> => (running ??= applyAll().finally(() => { running = null }))
