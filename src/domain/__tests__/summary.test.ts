import { describe, expect, it } from 'vitest'
import { answerQuestion } from '../harness'
import { type Question } from '../harness2'
import { answerRemoval, applySummary, planSummary, REMOVAL_ANSWERS, removalQuestion, summaryLines, summaryText } from '../summary'
import { TASK_TEXT_MAX_CHARS, type Task } from '../tasks'

// Synthetic fixtures only: the repo is public (HW-HARNESS.md §8).
const NOW = '2026-10-11T18:00:00.000Z'
const TODAY = '2026-10-11'
const task = (id: string, text: string, over: Partial<Task> = {}): Task => ({
  id, text, sourceEntryIds: ['n1'], due: null, state: 'open', followUpOn: null, by: 'harness', editedAt: null, runId: 'run-0',
  createdAt: NOW, updatedAt: NOW, ...over,
})
const A = task('a', 'Buy bulbs')
const B = task('b', 'Call the plumber')
const C = task('c', 'Book the dentist')
const shown = [A, B, C]
let n = 0
const opts = (questions: Question[] = []) => ({ today: TODAY, now: NOW, newId: () => `new-${++n}`, questions })
const ids = (ts: Task[]) => ts.map((t) => t.id)

describe('summary lines', () => {
  it('one line per task; list markers and empty lines are not content', () => {
    expect(summaryText(shown)).toBe('Buy bulbs\nCall the plumber\nBook the dentist')
    expect(summaryLines('- Buy bulbs\n\n• Call   the plumber\r\n2. Book the dentist\n[ ] Pay rent\n')).toEqual(['Buy bulbs', 'Call the plumber', 'Book the dentist', 'Pay rent'])
  })
})

describe('matching the edited summary (open point 1)', () => {
  it('unchanged text keeps every task (known negative: nothing to write)', () => {
    const p = planSummary(shown, summaryText(shown))
    expect([ids(p.kept), p.edits, p.adds, p.removes]).toEqual([['a', 'b', 'c'], [], [], []])
    const r = applySummary(p, opts())
    expect(r.ok && r.value).toEqual({ tasks: [], questions: [] })
  })
  it('a line changed in place is an edit of its task; a new line is an added task', () => {
    const p = planSummary(shown, 'Buy bulbs\nCall the plumber before Friday\nBook the dentist\nPay rent')
    expect(p.edits.map((e) => [e.task.id, e.text])).toEqual([['b', 'Call the plumber before Friday']])
    expect(p.adds).toEqual(['Pay rent'])
    expect(p.removes).toEqual([])
    const r = applySummary(p, opts())
    expect(r.ok && r.value.tasks.map((t) => [t.id, t.text, t.by])).toEqual([['b', 'Call the plumber before Friday', 'owner'], ['new-1', 'Pay rent', 'owner']])
  })
  it('a deleted line is a removal; a moved line is kept, not re-created', () => {
    const p = planSummary(shown, 'Book the dentist\nBuy bulbs')
    expect(ids(p.kept).sort()).toEqual(['a', 'c'])
    expect(ids(p.removes)).toEqual(['b'])
    expect(p.adds).toEqual([])
  })
  it('a rewrite the diff cannot pair becomes additions plus removals, for the owner to see before saving', () => {
    const p = planSummary([A], 'Buy bulbs\nTwo\nThree')
    expect(p.adds).toEqual(['Two', 'Three'])
    const q = planSummary([A, B], 'Something else entirely')
    expect(p.removes).toEqual([])
    expect([q.edits.map((e) => e.task.id), ids(q.removes)]).toEqual([['a'], ['b']])
  })
  it('a task whose text starts with a list marker survives an untouched save (review defect 1)', () => {
    const marked = [task('m', '- buy milk'), task('n', '1. call mum')]
    const p = planSummary(marked, summaryText(marked))
    expect([p.edits, p.adds, p.removes]).toEqual([[], [], []])
  })
  it('a moved line is matched before positional pairing: moving A and editing B never renames A (review defect 2)', () => {
    const p = planSummary(shown, ['Pay rent', 'Book the dentist', 'Buy bulbs'].join('\n'))
    expect(ids(p.kept).sort()).toEqual(['a', 'c'])
    expect(p.edits.map((e) => [e.task.id, e.text])).toEqual([['b', 'Pay rent']])
    expect([p.adds, p.removes]).toEqual([[], []])
  })
  it('a line too long to be a task refuses the whole save (nothing half-applied)', () => {
    const p = planSummary(shown, `Buy bulbs\nCall the plumber\nBook the dentist\n${'x'.repeat(TASK_TEXT_MAX_CHARS + 1)}`)
    expect(applySummary(p, opts()).ok).toBe(false)
  })
})

describe('the removal question (D-73)', () => {
  it('a removed line carries its task to tomorrow and asks at once; the task is never dropped by the save', () => {
    const r = applySummary(planSummary(shown, 'Buy bulbs\nBook the dentist'), opts())
    expect(r.ok && r.value.tasks).toEqual([{ ...B, followUpOn: '2026-10-12', updatedAt: NOW }])
    expect(r.ok && r.value.questions).toEqual([removalQuestion(B, TODAY, NOW)])
    expect(r.ok && r.value.questions[0]).toMatchObject({ taskId: 'b', entryId: null, kind: 'removal', state: 'open' })
  })
  it('one open removal question per task: removing it again while asked adds no second one', () => {
    const asked = removalQuestion(B, '2026-10-10', NOW)
    const r = applySummary(planSummary(shown, 'Buy bulbs\nBook the dentist'), opts([asked]))
    expect(r.ok && r.value.questions).toEqual([])
    // Known positive: once that question is answered, a new removal asks again.
    const answered = { ...asked, state: 'answered' as const, answer: 'later', answeredAt: NOW }
    const again = applySummary(planSummary(shown, 'Buy bulbs\nBook the dentist'), opts([answered]))
    expect(again.ok && again.value.questions).toHaveLength(1)
  })
  it('removing the same task twice in a day asks a new question; the answered one is never overwritten', () => {
    expect(removalQuestion(B, TODAY, NOW).id).not.toBe(removalQuestion(B, TODAY, '2026-10-11T19:00:00.000Z').id)
  })
  it('only the owner’s explicit "drop" drops the task; "keep" leaves it carried', () => {
    const carried = { ...B, followUpOn: '2026-10-12' }
    const q = removalQuestion(B, TODAY, NOW)
    const drop = answerRemoval(q, carried, 'drop', NOW)
    expect(drop.ok && drop.value.task).toMatchObject({ id: 'b', state: 'dropped', followUpOn: null })
    expect(drop.ok && drop.value.question).toMatchObject({ state: 'answered', answer: REMOVAL_ANSWERS.drop })
    const keep = answerRemoval(q, carried, 'keep', NOW)
    expect(keep.ok && keep.value.task).toBeNull()
    expect(keep.ok && keep.value.question.answer).toBe(REMOVAL_ANSWERS.keep)
  })
  it('a free-text reply answers the question and changes no task', () => {
    const r = answerQuestion(removalQuestion(B, TODAY, NOW), 'not sure yet', NOW)
    expect(r.ok && r.value).toMatchObject({ kind: 'removal', state: 'answered', answer: 'not sure yet' })
  })
  it('refuses a harness question, another task’s question, or an answered one', () => {
    const q = removalQuestion(B, TODAY, NOW)
    expect(answerRemoval({ ...q, kind: 'harness' }, B, 'drop', NOW).ok).toBe(false)
    expect(answerRemoval(q, A, 'drop', NOW).ok).toBe(false)
    expect(answerRemoval({ ...q, state: 'answered', answer: 'x', answeredAt: NOW }, B, 'drop', NOW).ok).toBe(false)
  })
})
