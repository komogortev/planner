import { describe, expect, it } from 'vitest'
import type { Entry } from '@/domain/entry'
import type { Question } from '@/domain/harness2'
import type { Applied2 } from '@/domain/harness2Reply'
import type { Task, TaskProposal } from '@/domain/tasks'
import { proposalLabel, runSummary2, stripItems, waitingShort } from '../queue2'

// Synthetic fixtures only (public repo).
const T = (h: number) => `2026-10-11T${String(h).padStart(2, '0')}:00:00.000Z`
const note = (id: string, body = `${id} first line\nsecond`): Entry => ({
  id, body, createdAt: T(8), occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: T(8), deletedAt: null, serverVersion: 1,
})
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, text: `task ${id}`, sourceEntryIds: [], due: null, state: 'open', followUpOn: null, by: 'harness', editedAt: null, runId: 'r1', createdAt: T(8), updatedAt: T(8), ...over,
})
const q = (id: string, at: number, over: Partial<Question> = {}): Question => ({
  id, entryId: null, taskId: 't1', kind: 'harness', text: `question ${id}`, state: 'open', answer: null, createdAt: T(at), answeredAt: null, runId: 'r1', ...over,
})
const prop = (id: string, at: number, over: Partial<TaskProposal> = {}): TaskProposal => ({
  id, op: 'close', taskIds: ['t1'], basis: ['task t1'], text: null, due: null, parts: [], entryId: 'n1', evidence: 'did it', state: 'proposed', runId: 'r1', createdAt: T(at), ...over,
})
const empty = { entries: [] as Entry[], questions: [] as Question[], tasks: [] as Task[], proposals: [] as TaskProposal[], states: [] }

describe('stripItems', () => {
  it('newest first; on one subject, proposals before questions; each item says what it is about', () => {
    const items = stripItems({
      ...empty,
      entries: [note('n1')],
      tasks: [task('t1'), task('t2')],
      questions: [q('qa', 9), q('qb', 10, { taskId: 't2' }), q('qc', 10), q('qn', 11, { taskId: null, entryId: 'n1' })],
      proposals: [prop('p1', 10)],
    })
    expect(items.map((i) => i.id)).toEqual(['qn', 'p1', 'qc', 'qb', 'qa'])
    expect(items.map((i) => i.about)).toEqual(['n1 first line', 'task t1', 'task t1', 'task t2', 'task t1'])
  })

  it('leaves out what has nothing left to decide: answered, or about a closed Task, a dropped note, an unknown subject', () => {
    const items = stripItems({
      ...empty,
      entries: [note('n1'), note('n2')],
      states: [{ id: 'n2', state: 'dropped', followUpOn: null, by: 'owner', updatedAt: T(9) }],
      tasks: [task('t1'), task('t9', { state: 'done' })],
      questions: [
        q('kept', 9),
        q('answered', 9, { state: 'answered', answer: 'x', answeredAt: T(10) }),
        q('closedTask', 9, { taskId: 't9' }),
        q('droppedNote', 9, { taskId: null, entryId: 'n2' }),
        q('unknown', 9, { taskId: 'nope' }),
      ],
      proposals: [prop('pClosed', 9, { taskIds: ['t9'] }), prop('pRejected', 9, { state: 'rejected' }), prop('pMerge', 9, { op: 'merge', taskIds: ['t1', 't9'], text: 'x' })],
    })
    expect(items.map((i) => i.id)).toEqual(['kept'])
  })
})

describe('proposalLabel', () => {
  const t1 = task('t1', { text: 'Buy bulbs', due: '2026-10-14' })
  it('says what confirming would do, per op', () => {
    expect(proposalLabel(prop('a', 9), [t1])).toBe('Done? A note says: “did it”')
    expect(proposalLabel(prop('b', 9, { op: 'revise', text: 'Buy E27 bulbs', due: '2026-10-14' }), [t1])).toBe('Change it: call it “Buy E27 bulbs”?')
    expect(proposalLabel(prop('c', 9, { op: 'revise', text: null, due: '2026-10-15' }), [t1])).toBe('Change it: due 2026-10-15?')
    expect(proposalLabel(prop('d', 9, { op: 'split', parts: [{ text: 'Hall', sourceEntryIds: [] }, { text: 'Porch', sourceEntryIds: [] }] }), [t1])).toBe('Split into: “Hall” · “Porch”?')
    expect(proposalLabel(prop('e', 9, { op: 'merge', taskIds: ['t1', 't2'], text: 'Lights' }), [t1, task('t2')])).toBe('Merge these into “Lights”?')
  })
})

describe('runSummary2', () => {
  it('counts new tasks by run id, other touched tasks, questions, proposals, and drops by reason (dedupe is not a drop)', () => {
    const a: Applied2 = {
      assessments: [{ id: 'a', entryId: 'n1', taskId: null, harnessVersion: 2, runId: 'r2', at: T(9) }],
      tasks: [task('new', { runId: 'r2' }), task('old', { runId: 'r1' })],
      proposals: [prop('p', 9)],
      questions: [q('x', 9)],
      dropped: [{ reason: 'deduped', ref: 'z' }, { reason: 'unknown-task', ref: 'y' }, { reason: 'unknown-task', ref: 'w' }],
    }
    expect(runSummary2(a, { runId: 'r2', toAssessIds: ['n1', 'n2'], reevaluateIds: ['old'] })).toEqual([
      '2 notes read · 1 changed task re-read',
      '1 new task · 1 task with new notes',
      '1 new question · 1 proposal',
      'Dropped: unknown-task ×2',
    ])
  })
})

describe('waitingShort: the strip at rest says what waits (alpha gap G5)', () => {
  it('names one kind, totals both, and is empty when nothing waits', () => {
    expect(waitingShort(1, 0)).toBe('1 new note')
    expect(waitingShort(3, 0)).toBe('3 new notes')
    expect(waitingShort(0, 1)).toBe('1 changed task')
    expect(waitingShort(0, 2)).toBe('2 changed tasks')
    expect(waitingShort(2, 1)).toBe('3 changes')
    expect(waitingShort(0, 0)).toBe('')
  })
})
