// Daily's editable summary (HW-HARNESS.md §11, D-71, D-73): one line per Task of today, edited as text, matched back to the
// Tasks on the device without a model call (open point 1). Pure and environment-free; the caller passes the new ids.
//
// Matching is a line diff of the shown list against the edited text: an unchanged line keeps its Task; within a run of
// changes, lines are paired by position (same place, new text = an edit) and the rest are additions or removals; a line
// that only moved is kept. A removed line never drops its Task (D-73): the Task is carried to tomorrow and the app asks,
// at once, what the removal means. Only the owner's explicit answer drops it.
import { addDays, oneLine, type Result } from './harness'
import { readQuestion, type Question } from './harness2'
import { addTask, checkTaskText, editTask, setTaskState, type Task } from './tasks'
import { uuid5 } from './uuid5'

export const REMOVAL_QUESTION = 'You took this off today’s summary. Drop it, or keep it for later?'
export const REMOVAL_ANSWERS = { drop: 'Drop it', keep: 'Keep it for later' } as const
export type RemovalChoice = keyof typeof REMOVAL_ANSWERS

/** The summary as shown: one line per Task, in Daily order. */
export function summaryText(today: Task[]): string {
  return today.map((t) => t.text).join('\n')
}

/** One line as the summary compares it: list markers ("- ", "• ", "1. ", "[ ] ") are not content. */
const asLine = (l: string): string => oneLine(l).replace(/^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]?\]\s+)/u, '').trim()

/** The edited text as lines; empty lines are not content. */
export function summaryLines(text: string): string[] {
  return text.split(/\r?\n/).map(asLine).filter((l) => l !== '')
}

export interface SummaryPlan {
  kept: Task[]
  edits: Array<{ task: Task; text: string }>
  adds: string[]
  removes: Task[]
}

/** Longest common subsequence of two line lists, as index pairs in order. */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1])
  const pairs: Array<[number, number]> = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i++, j++])
    else if (len[i + 1][j] >= len[i][j + 1]) i++
    else j++
  }
  return pairs
}

/**
 * What saving `edited` over the `shown` Tasks would do. Shown to the owner before it is applied. Both sides are compared
 * in the same cleaned form, so saving an untouched summary writes nothing even when a task's text starts with a marker.
 */
export function planSummary(shown: Task[], edited: string): SummaryPlan {
  const before = shown.map((t) => asLine(t.text))
  const after = summaryLines(edited)
  const plan: SummaryPlan = { kept: [], edits: [], adds: [], removes: [] }
  const hunks: Array<{ dels: Task[]; ins: string[] }> = []
  let i = 0
  let j = 0
  for (const [pi, pj] of [...lcs(before, after), [shown.length, after.length] as [number, number]]) {
    hunks.push({ dels: shown.slice(i, pi), ins: after.slice(j, pj) })
    if (pi < shown.length) plan.kept.push(shown[pi])
    i = pi + 1
    j = pj + 1
  }
  // A line that moved shows up as a removal in one place and an addition of the same text in another: it is kept, and is
  // matched across all changes before any positional pairing, so a moved line is never used up as an edit of its neighbour.
  for (const h of hunks) {
    h.ins = h.ins.filter((text) => {
      for (const g of hunks) {
        const k = g.dels.findIndex((t) => asLine(t.text) === text)
        if (k >= 0) return plan.kept.push(...g.dels.splice(k, 1)), false
      }
      return true
    })
  }
  for (const { dels, ins } of hunks) {
    const paired = Math.min(dels.length, ins.length)
    for (let k = 0; k < paired; k++) plan.edits.push({ task: dels[k], text: ins[k] })
    plan.removes.push(...dels.slice(paired))
    plan.adds.push(...ins.slice(paired))
  }
  return plan
}

/** The app's question under a removed Task, asked at once (no model call). One open removal question per Task at a time. */
export function removalQuestion(task: Task, today: string, now: string): Question {
  return {
    id: uuid5(`${task.id}|removed|${now}`), // per removal: a second removal the same day never overwrites an answered one
    entryId: null,
    taskId: task.id,
    kind: 'removal',
    text: REMOVAL_QUESTION,
    state: 'open',
    answer: null,
    createdAt: now,
    answeredAt: null,
    runId: `summary-${today}`,
  }
}

/**
 * The rows saving the summary writes: edited Tasks (owner text from then on), added Tasks (`by: owner`), and for each removed
 * Task a carry to tomorrow plus its removal question. Every edited or added Task enters the next run (constraint 5). A line
 * too long to be a Task refuses the whole save, so nothing is half-applied.
 */
export function applySummary(
  plan: SummaryPlan,
  opts: { today: string; now: string; newId: () => string; questions: Question[] },
): Result<{ tasks: Task[]; questions: Question[] }> {
  for (const text of [...plan.edits.map((e) => e.text), ...plan.adds]) {
    const t = checkTaskText(text)
    if (!t.ok) return { ok: false, error: `“${Array.from(text).slice(0, 40).join('')}…”: ${t.error}` }
  }
  const tasks: Task[] = []
  const questions: Question[] = []
  for (const e of plan.edits) {
    const r = editTask(e.task, { text: e.text }, opts.now)
    if (r.ok) tasks.push(r.value)
  }
  for (const text of plan.adds) {
    const r = addTask(opts.newId(), text, null, opts.now)
    if (!r.ok) return r
    tasks.push(r.value)
  }
  const tomorrow = addDays(opts.today, 1)
  for (const task of plan.removes) {
    const r = setTaskState(task, 'open', opts.now, tomorrow)
    if (!r.ok) return r
    tasks.push(r.value)
    const asking = opts.questions.some((q) => q.taskId === task.id && q.kind === 'removal' && q.state === 'open')
    if (!asking) questions.push(removalQuestion(task, opts.today, opts.now))
  }
  return { ok: true, value: { tasks, questions } }
}

/**
 * The owner's answer to a removal question. `drop` answers it and drops the Task; `keep` answers it and leaves the Task
 * carried. A free-text reply goes through `answerQuestion` instead and changes nothing but the question (the next run reads it).
 */
export function answerRemoval(q: Question, task: Task, choice: RemovalChoice, now: string): Result<{ question: Question; task: Task | null }> {
  const row = readQuestion(q)
  if (row.kind !== 'removal' || row.taskId !== task.id) return { ok: false, error: 'This is not the removal question of that task.' }
  if (row.state !== 'open') return { ok: false, error: 'This question is already closed.' }
  const question: Question = { ...row, state: 'answered', answer: REMOVAL_ANSWERS[choice], answeredAt: now }
  if (choice === 'keep' || task.state !== 'open') return { ok: true, value: { question, task: null } }
  const dropped = setTaskState(task, 'dropped', now)
  return dropped.ok ? { ok: true, value: { question, task: dropped.value } } : dropped
}
