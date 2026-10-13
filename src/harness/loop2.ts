// The daily loop on the device, harness v2 (HW-HARNESS §11, S3 v2 slice S3): Tasks derived from notes, questions keyed to
// the Task they isolate, Daily as an editable summary. The pure rules live in `domain/harness2*.ts`, `domain/tasks.ts` and
// `domain/summary.ts`; this file only reads the device's tables, keeps the waiting run (pending.ts) and writes through
// `writeRecords` (one transaction, outbox included). It never starts a sync itself: callers call `syncSoon()`.
// Dashboard v2 (QuestionsStrip, DailyCard) is its only caller; `loop.ts` keeps the optional journal (stage 2) and v1's reads.
import { db } from '@/db'
import { executorFields, type ModelVia } from '@/ai/runWith'
import { writeRecords, type RecordWrite, type WriteResult } from '@/db/records'
import { answerQuestion, dismissQuestion, localDay } from '@/domain/harness'
import { composeHarness2, readAssessment, readQuestion, selectCandidates2, type HarnessData2, type Question, type RunHeader2 } from '@/domain/harness2'
import { applyHarness2, parseHarnessOutput2, type Applied2 } from '@/domain/harness2Reply'
import type { RunRecord } from '@/domain/records'
import { answerRemoval, applySummary, planSummary, type RemovalChoice, type SummaryPlan } from '@/domain/summary'
import { addTask, confirmProposal, dailyTasks, editTask, upcomingTasks, rejectProposal, setTaskState, type Task, type TaskProposal, type TaskState } from '@/domain/tasks'
import { uuid } from '@/utils/uuid'
import { deviceZone, PendingStorageError, type Composed, type Outcome } from './loop'
import { clearPending, loadPending2, pendingIsOtherVersion, savePending } from './pending'

// No language setting exists yet (§9 point 4): the model answers in the language the owner wrote in.
const HARNESS_LANGUAGE = 'the same language as the notes they come from'

const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt)

/** Everything harness v2 and Daily read, from this device's copy of the signed-in account. S3a rows read as note rows. */
export async function loadHarnessData2(): Promise<HarnessData2> {
  const [entries, assessments, questions, tasks, proposals, states] = await Promise.all([
    db.entries.toArray(),
    db.assessments.toArray(),
    db.questions.toArray(),
    db.tasks.toArray(),
    db.taskProposals.toArray(),
    db.entryStates.toArray(),
  ])
  return {
    entries,
    assessments: live(assessments).map(readAssessment),
    questions: live(questions).map(readQuestion),
    tasks: live(tasks),
    proposals: live(proposals),
    states: live(states),
  }
}

/** Daily (D-69): the open Tasks whose day has come, in the device's zone. */
export function today(data: Pick<HarnessData2, 'tasks'>, now = new Date().toISOString()): { day: string; tasks: Task[]; upcoming: Task[] } {
  const zone = deviceZone()
  const day = localDay(now, zone)
  return { day, tasks: dailyTasks(data.tasks, day, zone), upcoming: upcomingTasks(data.tasks, day, zone) }
}

/** What the next run would carry, without composing one (the strip's count): composing replaces the waiting header. */
export function harnessWork(data: HarnessData2, now = new Date().toISOString()): { notes: number; tasks: number } {
  const sel = selectCandidates2(data, now)
  return { notes: sel.toAssess.length + sel.remaining, tasks: sel.reevaluate.length }
}

// Every owner action re-reads its rows by id before changing them: `writeRecords` writes what it is given over what the
// device holds (a rewrite is based on the held version), so acting on the screen's copy would silently undo a sync or a
// stored run that landed since — or confirm a proposal already rejected elsewhere.
const freshQuestion = async (id: string): Promise<Question | null> => {
  const q = await db.questions.get(id)
  return q && !q.deletedAt ? readQuestion(q) : null
}
const freshTask = async (id: string): Promise<Task | null> => {
  const t = await db.tasks.get(id)
  return t && !t.deletedAt ? t : null
}
const freshProposal = async (id: string): Promise<TaskProposal | null> => {
  const p = await db.taskProposals.get(id)
  return p && !p.deletedAt ? p : null
}
const GONE = { ok: false, error: 'This item is gone (removed on another device).' } as const

const asWrites = <T extends { id: string }>(recordKind: RecordWrite['recordKind'], rows: T[]): RecordWrite[] =>
  rows.map((row) => ({ recordKind, row: row as unknown as RecordWrite['row'] }))

const failed = (w: WriteResult): string => (w.ok ? '' : `Nothing was stored: ${w.errors.slice(0, 3).join('; ')}`)

async function write(writes: RecordWrite[], now: string): Promise<Outcome<number>> {
  const w = await writeRecords(db, writes, now)
  return w.ok ? { ok: true, value: w.written } : { ok: false, error: failed(w) }
}

// ── The harness run ────────────────────────────────────────────────────────────────────────────────────────────────

/** Compose the v2 prompt and remember its header until the reply comes back. Null = no note to assess, no task waiting. */
export async function startHarness2(now = new Date().toISOString()): Promise<Composed<RunHeader2>> {
  const out = composeHarness2(await loadHarnessData2(), { runId: uuid(), now, timeZone: deviceZone(), language: HARNESS_LANGUAGE })
  if (!out) clearPending('harness')
  else if (!savePending('harness', out.header)) throw new PendingStorageError()
  return out
}

export const pendingHarness2 = (): RunHeader2 | null => loadPending2()

/**
 * Check a pasted reply against the waiting run. With `store`, the surviving rows and the run record are written in one
 * transaction and the run stops waiting. The check is recomputed from the tables at the moment of storing, so a stale
 * preview can never store more than a fresh check allows.
 */
export async function applyHarnessReply2(text: string, opts: { store: boolean; now?: string; via?: ModelVia }): Promise<Outcome<{ applied: Applied2; header: RunHeader2; written: number }>> {
  const header = loadPending2()
  if (!header) {
    return pendingIsOtherVersion()
      ? { ok: false, error: 'This reply is for a prompt from the previous version of the app. Copy a new prompt.' }
      : { ok: false, error: 'No run is waiting for a reply. Copy a new prompt first.' }
  }
  const parsed = parseHarnessOutput2(text)
  if (!parsed.ok) return parsed
  const now = opts.now ?? new Date().toISOString()
  const applied = applyHarness2(parsed.value, header, await loadHarnessData2(), now, deviceZone())
  if (!opts.store) return { ok: true, value: { applied, header, written: 0 } }
  const run: RunRecord = {
    id: header.runId,
    stage: 'harness',
    version: header.harnessVersion,
    widgetId: null,
    entryIds: [...header.toAssessIds, ...header.contextIds],
    ranAt: header.composedAt,
    ...executorFields(opts.via),
    taskIds: header.taskIds,
  }
  const w = await writeRecords(
    db,
    [
      ...asWrites('task', applied.tasks),
      ...asWrites('taskProposal', applied.proposals),
      ...asWrites('assessment', applied.assessments),
      ...asWrites('question', applied.questions),
      ...asWrites('run', [run]),
    ],
    now,
  )
  if (!w.ok) return { ok: false, error: failed(w) }
  clearPending('harness')
  return { ok: true, value: { applied, header, written: w.written } }
}

// ── Questions ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A reply. It reopens its Task (or note) for the next run: `tasksWaiting` / `selectCandidates2` read `answeredAt`. */
export async function answer2(shown: Pick<Question, 'id'>, text: string, now = new Date().toISOString()): Promise<Outcome<number>> {
  const q = await freshQuestion(shown.id)
  if (!q) return GONE
  const r = answerQuestion(q, text, now)
  return r.ok ? write(asWrites('question', [r.value]), now) : r
}

/** Skip: always fine (D-70, mood is a valid reason). */
export async function dismiss2(shown: Pick<Question, 'id'>, now = new Date().toISOString()): Promise<Outcome<number>> {
  const q = await freshQuestion(shown.id)
  if (!q) return GONE
  const r = dismissQuestion(q)
  return r.ok ? write(asWrites('question', [r.value]), now) : r
}

/** Drop it / keep it for later, on a removal question (D-73, D-76). Free text goes through `answer2`. */
export async function answerRemoval2(shown: Pick<Question, 'id'>, choice: RemovalChoice, now = new Date().toISOString()): Promise<Outcome<number>> {
  const q = await freshQuestion(shown.id)
  const task = q?.taskId ? await freshTask(q.taskId) : null
  if (!q || !task) return GONE
  const r = answerRemoval(q, task, choice, now)
  if (!r.ok) return r
  return write([...asWrites('question', [r.value.question]), ...(r.value.task ? asWrites('task', [r.value.task]) : [])], now)
}

// ── Tasks: the owner's own edits ───────────────────────────────────────────────────────────────────────────────────

/** "+ task". */
export async function addTask2(text: string, due: string | null = null, now = new Date().toISOString()): Promise<Outcome<number>> {
  const r = addTask(uuid(), text, due, now)
  return r.ok ? write(asWrites('task', [r.value]), now) : r
}

/** Tap-to-edit: owner text from then on; the task enters the next run. */
export async function editTask2(shown: Pick<Task, 'id'>, change: { text?: string; due?: string | null }, now = new Date().toISOString()): Promise<Outcome<number>> {
  const task = await freshTask(shown.id)
  if (!task) return GONE
  const r = editTask(task, change, now)
  return r.ok ? write(asWrites('task', [r.value]), now) : r
}

/** Done · drop · tomorrow (open with `followUpOn`) · reopen. */
export async function setTaskState2(shown: Pick<Task, 'id'>, state: TaskState, followUpOn: string | null = null, now = new Date().toISOString()): Promise<Outcome<number>> {
  const task = await freshTask(shown.id)
  if (!task) return GONE
  const r = setTaskState(task, state, now, followUpOn)
  return r.ok ? write(asWrites('task', [r.value]), now) : r
}

// ── The editable summary (D-71, D-73) ──────────────────────────────────────────────────────────────────────────────

/** What saving `edited` over the shown Tasks would do: shown to the owner before saving. Pure. */
export const previewSummary = (shown: Task[], edited: string): SummaryPlan => planSummary(shown, edited)

/**
 * Save an edited summary: edits, added Tasks, and for each removed line a carry to tomorrow plus its removal question.
 * `shown` is exactly the list the owner edited. If any of it changed since (a sync, a stored run, another tab), the save is
 * refused: diffing against a different list would read a line the owner never saw as removed, or undo the change.
 */
export async function saveSummary(shown: Task[], edited: string, now = new Date().toISOString()): Promise<Outcome<number>> {
  const data = await loadHarnessData2()
  const byId = new Map(data.tasks.map((t) => [t.id, t]))
  const fresh = shown.map((t) => byId.get(t.id))
  if (fresh.some((t, i) => t === undefined || t.state !== 'open' || t.updatedAt !== shown[i].updatedAt)) {
    return { ok: false, error: 'Today’s list changed while you were editing. Nothing was saved.' }
  }
  const r = applySummary(planSummary(fresh as Task[], edited), { today: localDay(now, deviceZone()), now, newId: uuid, questions: data.questions })
  if (!r.ok) return r
  if (r.value.tasks.length === 0 && r.value.questions.length === 0) return { ok: true, value: 0 }
  return write([...asWrites('task', r.value.tasks), ...asWrites('question', r.value.questions)], now)
}

// ── Proposals (close · revise · split · merge): only the owner applies them ────────────────────────────────────────

export async function confirmProposal2(shown: Pick<TaskProposal, 'id'>, now = new Date().toISOString()): Promise<Outcome<number>> {
  const p = await freshProposal(shown.id)
  if (!p) return GONE
  const r = confirmProposal(p, live(await db.tasks.toArray()), now)
  if (!r.ok) return r
  return write([...asWrites('taskProposal', [r.value.proposal]), ...asWrites('task', r.value.tasks)], now)
}

export async function rejectProposal2(shown: Pick<TaskProposal, 'id'>, now = new Date().toISOString()): Promise<Outcome<number>> {
  const p = await freshProposal(shown.id)
  if (!p) return GONE
  const r = rejectProposal(p)
  return r.ok ? write(asWrites('taskProposal', [r.value]), now) : r
}
