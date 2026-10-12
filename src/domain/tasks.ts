// Tasks derived from notes (HW-HARNESS.md §11, D-69…D-73): the Task record, the owner's edits, Daily, and the owner's
// answer to a harness proposal. Pure and environment-free, like `harness.ts`: no Dexie, Vue, DOM or Workers APIs, no clock
// reads, no randomness (a new owner task's id is an argument; derived ids are uuid v5).
//
// Who may write what: the harness creates a Task and may grow its sources (`attach`); everything else it says about an
// existing Task is a proposal (`TaskProposal`) that only the owner's confirmation applies. **The model never overwrites
// owner text** — `by` records who wrote `text` last, and an owner edit (`editedAt`) puts the Task into the next run.
import { isIsoDate, isWellFormed } from './clean'
import { localDay, oneLine, type Result } from './harness'
import { uuid5 } from './uuid5'

export const TASK_TEXT_MAX_CHARS = 200
export const TASK_SOURCES_MAX = 200
export const SPLIT_PARTS_MAX = 5
export const MERGE_TASKS_MAX = 5

// ── Records ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TaskState = 'open' | 'done' | 'dropped'
export interface Task {
  id: string // uuid5(runId|normalized text) when the harness creates it (a replay is a no-op) · uuid v4 when the owner adds it
  text: string // one line, the task as the owner would say it
  sourceEntryIds: string[] // every note that contributed; grows when a later note joins the topic
  due: string | null // YYYY-MM-DD, only when a note implies it (or the owner sets it)
  state: TaskState
  followUpOn: string | null // a carry: the day it comes back to Daily. Only an open task has one
  by: 'harness' | 'owner' // who wrote `text` last
  editedAt: string | null // last owner edit of text or due; newer than the task's last assessment ⇒ in the next run
  runId: string | null // the run that created it; null for a task the owner added
  createdAt: string
  updatedAt: string
}

export type ProposalOp = 'close' | 'revise' | 'split' | 'merge'
export type ProposalState = 'proposed' | 'confirmed' | 'rejected'
export interface TaskPart {
  text: string
  sourceEntryIds: string[]
}
/** Something the harness says about existing Tasks that only the owner may apply. Proposed once, whatever its state later. */
export interface TaskProposal {
  id: string // uuid5(op|task ids|content)
  op: ProposalOp
  taskIds: string[] // close · revise · split: one · merge: 2…MERGE_TASKS_MAX
  basis: string[] // each task's text when proposed: confirming is refused once the owner has changed one
  text: string | null // revise (optional) · merge (required)
  due: string | null // revise only
  parts: TaskPart[] // split only
  entryId: string | null // close: the note that says it is done
  evidence: string // close: a short quote from that note
  state: ProposalState
  runId: string
  createdAt: string
}

// ── Text and days ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Task identity: case, spacing and trailing punctuation do not make a different task. */
export function normalizeTaskText(text: string): string {
  return oneLine(text).toLowerCase().replace(/[\s.!?;:,]+$/u, '')
}

/** A task's text as stored, or why it cannot be. */
export function checkTaskText(raw: string): Result<string> {
  if (!isWellFormed(raw)) return { ok: false, error: 'The text is not valid.' }
  const text = oneLine(raw)
  if (text === '') return { ok: false, error: 'The task is empty.' }
  if (Array.from(text).length > TASK_TEXT_MAX_CHARS) return { ok: false, error: `A task is at most ${TASK_TEXT_MAX_CHARS} characters.` }
  return { ok: true, value: text }
}

/** The day a task belongs to: its carry, else its due date, else the day it was created. */
export function dayOf(task: Task, timeZone: string): string {
  return task.followUpOn ?? task.due ?? localDay(task.createdAt, timeZone)
}

/** Daily = the open Tasks whose day has come (D-69, §11 point 3), in a fixed order: day, then creation, then id. */
export function dailyTasks(tasks: Task[], today: string, timeZone: string): Task[] {
  return tasks
    .filter((t) => t.state === 'open' && dayOf(t, timeZone) <= today)
    .map((t) => ({ t, day: dayOf(t, timeZone) }))
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.t.createdAt !== b.t.createdAt ? (a.t.createdAt < b.t.createdAt ? -1 : 1) : a.t.id < b.t.id ? -1 : 1))
    .map((x) => x.t)
}

// ── The owner's edits: each returns the row to write ───────────────────────────────────────────────────────────────

const checkDue = (due: string | null): Result<string | null> =>
  due === null || isIsoDate(due) ? { ok: true, value: due } : { ok: false, error: 'The date is not YYYY-MM-DD.' }

/** "+ task", or a line added to the summary. The id is the caller's uuid v4. */
export function addTask(id: string, rawText: string, due: string | null, now: string): Result<Task> {
  const text = checkTaskText(rawText)
  if (!text.ok) return text
  const d = checkDue(due)
  if (!d.ok) return d
  return {
    ok: true,
    value: { id, text: text.value, sourceEntryIds: [], due: d.value, state: 'open', followUpOn: null, by: 'owner', editedAt: now, runId: null, createdAt: now, updatedAt: now },
  }
}

/** Tap-to-edit, or a changed summary line. An edit is owner text from then on, and enters the next run (constraint 5). */
export function editTask(task: Task, change: { text?: string; due?: string | null }, now: string): Result<Task> {
  let text = task.text
  if (change.text !== undefined) {
    const t = checkTaskText(change.text)
    if (!t.ok) return t
    text = t.value
  }
  let due = task.due
  if (change.due !== undefined) {
    const d = checkDue(change.due)
    if (!d.ok) return d
    due = d.value
  }
  if (text === task.text && due === task.due) return { ok: false, error: 'Nothing changed.' }
  return { ok: true, value: { ...task, text, due, by: text === task.text ? task.by : 'owner', editedAt: now, updatedAt: now } }
}

/** Done · drop · carry to a day · reopen. A state change is not an edit: it does not put the task into the next run. */
export function setTaskState(task: Task, state: TaskState, now: string, followUpOn: string | null = null): Result<Task> {
  if (followUpOn !== null && (state !== 'open' || !isIsoDate(followUpOn))) return { ok: false, error: 'Only an open task carries a YYYY-MM-DD follow-up day.' }
  return { ok: true, value: { ...task, state, followUpOn: state === 'open' ? followUpOn : null, updatedAt: now } }
}

// ── The owner's answer to a proposal ───────────────────────────────────────────────────────────────────────────────

const union = (...lists: string[][]) => [...new Set(lists.flat())].slice(0, TASK_SOURCES_MAX)

/**
 * Apply a confirmed proposal. A proposal whose tasks left `open` meanwhile is confirmed with no effect (as `confirmLink`).
 * One whose task the owner changed since it was proposed (text, or any later edit) is refused: the owner wins, and it can be rejected.
 * Split drops the original and creates its parts (ids derived from the proposal: confirming twice cannot duplicate them).
 * Merge keeps the oldest task — its questions stay its thread — with the proposed text and every source; the rest are dropped.
 */
export function confirmProposal(p: TaskProposal, tasks: Task[], now: string): Result<{ proposal: TaskProposal; tasks: Task[] }> {
  if (p.state !== 'proposed') return { ok: false, error: 'This proposal was already answered.' }
  const proposal: TaskProposal = { ...p, state: 'confirmed' }
  const named = p.taskIds.map((id) => tasks.find((t) => t.id === id))
  if (named.some((t) => t === undefined || t.state !== 'open')) return { ok: true, value: { proposal, tasks: [] } }
  const targets = named as Task[]
  // The owner's newer word wins: changed text, or any owner edit (text or date) after the proposal was made.
  const changed = targets.some((t, i) => t.text !== p.basis[i] || (t.editedAt !== null && t.editedAt > p.createdAt))
  if (p.op !== 'close' && changed) return { ok: false, error: 'The task changed since this was proposed.' }
  const [first] = targets
  switch (p.op) {
    case 'close':
      return { ok: true, value: { proposal, tasks: [{ ...first, state: 'done', followUpOn: null, updatedAt: now }] } }
    case 'revise': {
      const text = p.text ?? first.text
      return { ok: true, value: { proposal, tasks: [{ ...first, text, due: p.due ?? first.due, by: text === first.text ? first.by : 'harness', updatedAt: now }] } }
    }
    case 'split': {
      const parts: Task[] = p.parts.map((part, i) => ({
        id: uuid5(`${p.id}|${i}`),
        text: part.text,
        sourceEntryIds: part.sourceEntryIds,
        due: first.due,
        state: 'open',
        followUpOn: first.followUpOn,
        by: 'harness',
        editedAt: null,
        runId: p.runId,
        createdAt: now,
        updatedAt: now,
      }))
      return { ok: true, value: { proposal, tasks: [{ ...first, state: 'dropped', followUpOn: null, updatedAt: now }, ...parts] } }
    }
    case 'merge': {
      const [keep, ...rest] = [...targets].sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1))
      const dues = targets.map((t) => t.due).filter((d): d is string => d !== null).sort()
      const text = p.text ?? keep.text
      const kept: Task = { ...keep, text, sourceEntryIds: union(keep.sourceEntryIds, ...rest.map((t) => t.sourceEntryIds)), due: dues[0] ?? null, by: text === keep.text ? keep.by : 'harness', updatedAt: now }
      return { ok: true, value: { proposal, tasks: [kept, ...rest.map((t): Task => ({ ...t, state: 'dropped', followUpOn: null, updatedAt: now }))] } }
    }
  }
}

export function rejectProposal(p: TaskProposal): Result<TaskProposal> {
  return p.state === 'proposed' ? { ok: true, value: { ...p, state: 'rejected' } } : { ok: false, error: 'This proposal was already answered.' }
}
