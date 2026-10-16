// Summary v3 on the device (D-109, R3): the day's buckets for the card, and the evening brief's run. The pure rules live in
// `domain/summaryLens.ts`; the reply is checked by v1's `validateReport` and written through `writeRecords`, as the journal
// was. It shares the widget pending slot with v1; a v1 header found there is never taken (`isSummaryHeader`).
import { db } from '@/db'
import { executorFields, type ModelVia } from '@/ai/runWith'
import { writeRecords, type RecordWrite } from '@/db/records'
import { validateReport, type Report } from '@/domain/journal'
import { cleanRecord, type RunRecord } from '@/domain/records'
import { composedToday, composeSummary, dayBuckets, fenceSummary, isSummaryHeader, type DayBuckets, type SummaryHeader } from '@/domain/summaryLens'
import type { Task } from '@/domain/tasks'
import { uuid } from '@/utils/uuid'
import { deviceZone, PendingStorageError, type Composed, type Outcome } from './loop'
import { NO_MODEL_REPLY } from './loop2'
import { clearPending, loadPending, savePending } from './pending'

// No language setting exists yet (§9 point 4): the model answers in the language the owner wrote in.
const SUMMARY_LANGUAGE = 'the language most of the Tasks and notes are written in'

const liveTasks = (rows: Array<Task & { deletedAt?: string | null }>) => rows.filter((t) => !t.deletedAt)

/** Today's four buckets from a list of Task rows, in the device's zone. */
export const todayBuckets = (tasks: Array<Task & { deletedAt?: string | null }>, now = new Date().toISOString()): DayBuckets =>
  dayBuckets(liveTasks(tasks), now, deviceZone())

export async function startSummary(now = new Date().toISOString()): Promise<Composed<SummaryHeader>> {
  const [tasks, entries] = await Promise.all([db.tasks.toArray(), db.entries.toArray()])
  const out = composeSummary({ tasks: liveTasks(tasks), entries }, { runId: uuid(), now, timeZone: deviceZone(), language: SUMMARY_LANGUAGE })
  if (!out) {
    if (pendingSummary()) clearPending('widget')
    return null
  }
  if (!savePending('widget', out.header)) throw new PendingStorageError()
  return { prompt: out.prompt, header: out.header }
}

/** The waiting brief's header, or null (none, malformed, or a v1 journal header). */
export const pendingSummary = (): SummaryHeader | null => {
  const h = loadPending('widget')
  return isSummaryHeader(h) ? h : null
}

/** Check a reply against the waiting run; with `store`, keep it (immutable: a second reply for the same run is refused). */
export async function applySummaryReply(text: string, opts: { store: boolean; now?: string; via?: ModelVia }): Promise<Outcome<{ report: Report; written: number }>> {
  const header = pendingSummary()
  if (!header) return { ok: false, error: 'No summary run is waiting for a reply. Start a new one.' }
  const now = opts.now ?? new Date().toISOString()
  if (!composedToday(header, now, deviceZone())) {
    clearPending('widget')
    return { ok: false, error: 'This brief was started on an earlier day, so it would describe that day. Start a new one.' }
  }
  const known = new Set((await db.reports.toArray()).map((r) => r.id))
  const v = validateReport(text, header, await db.entries.toArray(), now, known, fenceSummary)
  if (!v.ok) return v
  const report: Report = { ...v.value, executor: 'model' }
  const rec = cleanRecord('report', { ...report, deletedAt: null })
  if (!rec.ok) return { ok: false, error: `This summary cannot be stored: ${rec.errors.slice(0, 2).join('; ')}` }
  if (!opts.store) return { ok: true, value: { report, written: 0 } }
  if (!opts.via) return { ok: false, error: NO_MODEL_REPLY }
  const run: RunRecord = {
    id: header.runId,
    stage: 'widget',
    version: header.lensVersion,
    widgetId: header.widgetId,
    entryIds: header.entryIds,
    ranAt: header.composedAt,
    ...executorFields(opts.via),
  }
  const writes: RecordWrite[] = [
    { recordKind: 'report', row: report as unknown as RecordWrite['row'] },
    { recordKind: 'run', row: run as unknown as RecordWrite['row'] },
  ]
  const w = await writeRecords(db, writes, now)
  if (!w.ok) return { ok: false, error: `Nothing was stored: ${w.errors.slice(0, 3).join('; ')}` }
  clearPending('widget')
  return { ok: true, value: { report, written: w.written } }
}
