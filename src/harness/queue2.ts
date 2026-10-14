// The questions strip, harness v2 (HW-HARNESS §11, D-70): every open question and every open proposal, one at a time, each
// shown under the Task (or note) it is about so the owner can see how the harness split the topics. Pure.
//
// Order: the newest run's items lead (a run's questions are what the owner came for), then by subject, proposals before
// questions on the same subject. A removal question (D-73, written by the app at save time) is newest by construction.
// Items about a Task that is no longer open, or a note that is done, dropped or deleted, are left out: nothing is left to
// decide (a closed Task's open question would go nowhere — the harness never re-reads a closed Task).
import type { Entry } from '@/domain/entry'
import { stateOf, type EntryState } from '@/domain/harness'
import type { HarnessData2, Question, RunHeader2 } from '@/domain/harness2'
import type { Applied2 } from '@/domain/harness2Reply'
import type { Task, TaskProposal } from '@/domain/tasks'

export type StripItem =
  | { kind: 'question'; id: string; at: string; about: string; task: Task | null; question: Question }
  | { kind: 'proposal'; id: string; at: string; about: string; tasks: Task[]; proposal: TaskProposal }

/** The first line of a note, as the "about" line of a question on it. */
const firstLine = (e: Entry) => e.body.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''

export function stripItems(data: Pick<HarnessData2, 'entries' | 'questions' | 'tasks' | 'proposals' | 'states'>): StripItem[] {
  const openTasks = new Map(data.tasks.filter((t) => t.state === 'open').map((t) => [t.id, t]))
  const states: EntryState[] = data.states
  const notes = new Map(data.entries.filter((e) => !e.deletedAt && stateOf(states, e.id) === 'open').map((e) => [e.id, e]))
  const items: StripItem[] = []
  for (const q of data.questions) {
    if (q.state !== 'open') continue
    if (q.taskId !== null) {
      const task = openTasks.get(q.taskId)
      if (task) items.push({ kind: 'question', id: q.id, at: q.createdAt, about: task.text, task, question: q })
    } else if (q.entryId !== null) {
      const note = notes.get(q.entryId)
      if (note) items.push({ kind: 'question', id: q.id, at: q.createdAt, about: firstLine(note), task: null, question: q })
    }
  }
  for (const p of data.proposals) {
    if (p.state !== 'proposed') continue
    const tasks = p.taskIds.map((id) => openTasks.get(id))
    if (tasks.some((t) => t === undefined)) continue // a named Task left `open`: confirming would change nothing
    const named = tasks as Task[]
    items.push({ kind: 'proposal', id: p.id, at: p.createdAt, about: named.map((t) => t.text).join(' · '), tasks: named, proposal: p })
  }
  const subject = (i: StripItem) => (i.kind === 'proposal' ? i.proposal.taskIds[0] : (i.question.taskId ?? i.question.entryId ?? ''))
  return items.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1
    if (subject(a) !== subject(b)) return subject(a) < subject(b) ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'proposal' ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
}

/** What each answer to a proposal does, named on its button (owner, 2026-10-13: Yes · No named no outcome). */
export function proposalActions(p: Pick<TaskProposal, 'op'>): { yes: string; no: string } {
  switch (p.op) {
    case 'close':
      return { yes: 'Mark done', no: 'Keep open' }
    case 'revise':
      return { yes: 'Apply change', no: 'Keep as is' }
    case 'split':
      return { yes: 'Split', no: 'Keep as one' }
    case 'merge':
      return { yes: 'Merge', no: 'Keep separate' }
  }
}

/** What a proposal asks the owner, in plain words. Model text is returned as text, never markup. */
export function proposalLabel(p: TaskProposal, tasks: Task[]): string {
  switch (p.op) {
    case 'close':
      return `Done? A note says: “${p.evidence}”`
    case 'revise': {
      const parts = [p.text !== null && p.text !== tasks[0]?.text ? `call it “${p.text}”` : null, p.due !== null && p.due !== tasks[0]?.due ? `due ${p.due}` : null]
      return `Change it: ${parts.filter(Boolean).join(', ') || 'no visible change'}?`
    }
    case 'split':
      return `Split into: ${p.parts.map((x) => `“${x.text}”`).join(' · ')}?`
    case 'merge':
      return `Merge these into “${p.text ?? tasks[0]?.text ?? ''}”?`
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The Check preview of a v2 reply: what Store would write, and what was dropped and why. */
export function runSummary2(a: Applied2, run: Pick<RunHeader2, 'runId' | 'toAssessIds' | 'reevaluateIds'>): string[] {
  const created = a.tasks.filter((t) => t.runId === run.runId).length
  const lines = [
    `${plural(run.toAssessIds.length, 'note')} read · ${plural(run.reevaluateIds.length, 'changed task')} re-read`,
    `${plural(created, 'new task')} · ${plural(a.tasks.length - created, 'task')} with new notes`,
    `${plural(a.questions.length, 'new question')} · ${plural(a.proposals.length, 'proposal')}`,
  ]
  if (a.dropped.length) {
    const by = new Map<string, number>()
    for (const d of a.dropped) if (d.reason !== 'deduped') by.set(d.reason, (by.get(d.reason) ?? 0) + 1)
    if (by.size) lines.push(`Dropped: ${[...by].map(([r, n]) => `${r} ×${n}`).join(', ')}`)
  }
  if (a.assessments.length === 0) lines.push('Nothing new would be stored (a replay, or every row was dropped).')
  return lines
}

/**
 * What waits for a run, in a few words, for the strip's resting line (alpha gap G5): "1 new note", "2 changed tasks",
 * or "3 changes" when both kinds wait. Empty when nothing waits. The line said only "Questions 0" with notes waiting,
 * which read as nothing to do — and that line is the only way into the loop.
 */
export function waitingShort(notes: number, tasks: number): string {
  if (notes && tasks) return `${notes + tasks} changes`
  if (notes) return `${notes} new note${notes === 1 ? '' : 's'}`
  if (tasks) return `${tasks} changed task${tasks === 1 ? '' : 's'}`
  return ''
}
