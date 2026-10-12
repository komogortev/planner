import { describe, expect, it } from 'vitest'
import {
  addTask,
  confirmProposal,
  dailyTasks,
  dayOf,
  editTask,
  normalizeTaskText,
  rejectProposal,
  setTaskState,
  TASK_TEXT_MAX_CHARS,
  upcomingTasks,
  type Task,
  type TaskProposal,
} from '../tasks'

// Synthetic fixtures only: the repo is public (HW-HARNESS.md §8).
const NOW = '2026-10-11T18:00:00.000Z'
const LATER = '2026-10-11T19:00:00.000Z'
const TZ = 'UTC'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', text: 'Buy bulbs', sourceEntryIds: ['n1'], due: null, state: 'open', followUpOn: null, by: 'harness', editedAt: null,
  runId: 'run-0', createdAt: NOW, updatedAt: NOW, ...over,
})
const proposal = (over: Partial<TaskProposal>): TaskProposal => ({
  id: 'p1', op: 'close', taskIds: ['t1'], basis: ['Buy bulbs'], text: null, due: null, parts: [], entryId: 'n2', evidence: 'got them',
  state: 'proposed', runId: 'run-1', createdAt: NOW, ...over,
})

describe('task text', () => {
  it('normalizes case, spacing and trailing punctuation, nothing else', () => {
    expect(normalizeTaskText('  Buy   BULBS. ')).toBe('buy bulbs')
    expect(normalizeTaskText('Buy bulbs')).not.toBe(normalizeTaskText('Buy a bulb'))
  })
})

describe('Daily', () => {
  it('a task belongs to its carry, else its due date, else its creation day', () => {
    expect(dayOf(task(), TZ)).toBe('2026-10-11')
    expect(dayOf(task({ due: '2026-10-20' }), TZ)).toBe('2026-10-20')
    expect(dayOf(task({ due: '2026-10-20', followUpOn: '2026-10-12' }), TZ)).toBe('2026-10-12')
  })
  it('lists open tasks whose day has come, in day order; done, dropped and future ones are absent', () => {
    const rows = [
      task({ id: 'a', createdAt: '2026-10-10T08:00:00.000Z' }),
      task({ id: 'b', followUpOn: '2026-10-09' }),
      task({ id: 'c', due: '2026-10-12' }),
      task({ id: 'd', state: 'done' }),
      task({ id: 'e', state: 'dropped' }),
    ]
    expect(dailyTasks(rows, '2026-10-11', TZ).map((t) => t.id)).toEqual(['b', 'a'])
    expect(dailyTasks(rows, '2026-10-12', TZ).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })
  it('Coming up: open tasks whose day is after today and within 7 days, never one Daily already lists', () => {
    const rows = [
      task({ id: 'today', due: '2026-10-12' }),
      task({ id: 'late', followUpOn: '2026-10-09' }),
      task({ id: 'deadline', due: '2026-10-18' }),
      task({ id: 'edge', due: '2026-10-19' }),
      task({ id: 'far', due: '2026-10-20' }),
      task({ id: 'carried', due: '2026-10-30', followUpOn: '2026-10-13' }),
      task({ id: 'done', due: '2026-10-14', state: 'done' }),
      task({ id: 'dropped', due: '2026-10-14', state: 'dropped' }),
    ]
    expect(upcomingTasks(rows, '2026-10-12', TZ).map((t) => t.id)).toEqual(['carried', 'deadline', 'edge'])
    const daily = new Set(dailyTasks(rows, '2026-10-12', TZ).map((t) => t.id))
    expect(upcomingTasks(rows, '2026-10-12', TZ).some((t) => daily.has(t.id))).toBe(false)
  })
})

describe('owner edits', () => {
  it('an added task is owner text, edited now, with no run (it is waiting for the next run)', () => {
    const r = addTask('u1', '  Call the plumber ', null, NOW)
    expect(r.ok && r.value).toMatchObject({ id: 'u1', text: 'Call the plumber', by: 'owner', editedAt: NOW, runId: null, state: 'open' })
  })
  it('refuses empty, over-long and bad-date tasks', () => {
    expect(addTask('u1', '   ', null, NOW).ok).toBe(false)
    expect(addTask('u1', 'x'.repeat(TASK_TEXT_MAX_CHARS + 1), null, NOW).ok).toBe(false)
    expect(addTask('u1', 'x'.repeat(TASK_TEXT_MAX_CHARS), null, NOW).ok).toBe(true)
    expect(addTask('u1', 'ok', '2026-13-01', NOW).ok).toBe(false)
  })
  it('a text edit makes the text the owner’s; a date-only edit keeps the author but still marks the edit', () => {
    const t = editTask(task(), { text: 'Buy LED bulbs' }, LATER)
    expect(t.ok && t.value).toMatchObject({ text: 'Buy LED bulbs', by: 'owner', editedAt: LATER })
    const d = editTask(task(), { due: '2026-10-15' }, LATER)
    expect(d.ok && d.value).toMatchObject({ text: 'Buy bulbs', by: 'harness', due: '2026-10-15', editedAt: LATER })
  })
  it('an edit that changes nothing is refused (no write, no re-run)', () => {
    expect(editTask(task(), { text: ' Buy  bulbs ' }, LATER).ok).toBe(false)
  })
  it('a state change is not an edit; only an open task carries a day', () => {
    const done = setTaskState(task({ followUpOn: '2026-10-12' }), 'done', LATER)
    expect(done.ok && done.value).toMatchObject({ state: 'done', followUpOn: null, editedAt: null })
    expect(setTaskState(task(), 'dropped', LATER, '2026-10-12').ok).toBe(false)
    const carried = setTaskState(task(), 'open', LATER, '2026-10-12')
    expect(carried.ok && carried.value.followUpOn).toBe('2026-10-12')
  })
})

describe('proposals', () => {
  it('close marks the task done', () => {
    const r = confirmProposal(proposal({}), [task()], LATER)
    expect(r.ok && r.value.tasks).toEqual([task({ state: 'done', updatedAt: LATER })])
  })
  it('revise is refused once the owner changed the text after it was proposed (owner text wins)', () => {
    const p = proposal({ op: 'revise', text: 'Buy 3 bulbs', entryId: null, evidence: '' })
    const ownerEdited = task({ text: 'Buy bulbs at the corner shop', by: 'owner', editedAt: LATER })
    expect(confirmProposal(p, [ownerEdited], LATER)).toEqual({ ok: false, error: 'The task changed since this was proposed.' })
    // Known positive: the same proposal over the unchanged text applies.
    const r = confirmProposal(p, [task()], LATER)
    expect(r.ok && r.value.tasks[0]).toMatchObject({ text: 'Buy 3 bulbs', by: 'harness' })
  })
  it('a date-only revise is refused after the owner edited the date since it was proposed', () => {
    const p = proposal({ op: 'revise', due: '2026-10-14', entryId: null, evidence: '', createdAt: NOW })
    expect(confirmProposal(p, [task({ due: '2026-10-30', editedAt: LATER })], LATER).ok).toBe(false)
  })
  it('a merge that keeps the owner text keeps it the owner’s (review defect 3)', () => {
    const p = proposal({ op: 'merge', taskIds: ['t1', 't2'], basis: ['Buy bulbs', 'Get bulbs'], text: 'Buy bulbs', entryId: null, evidence: '' })
    const r = confirmProposal(p, [task({ by: 'owner' }), task({ id: 't2', text: 'Get bulbs', createdAt: LATER })], LATER)
    expect(r.ok && r.value.tasks[0]).toMatchObject({ id: 't1', by: 'owner' })
  })
  it('a date-only revise keeps the author', () => {
    const p = proposal({ op: 'revise', due: '2026-10-14', entryId: null, evidence: '' })
    const r = confirmProposal(p, [task({ by: 'owner' })], LATER)
    expect(r.ok && r.value.tasks[0]).toMatchObject({ text: 'Buy bulbs', by: 'owner', due: '2026-10-14' })
  })
  it('split drops the original and creates its parts with derived ids (confirming again cannot duplicate them)', () => {
    const p = proposal({ op: 'split', parts: [{ text: 'Buy bulbs', sourceEntryIds: ['n1'] }, { text: 'Fix the lamp', sourceEntryIds: ['n1'] }], entryId: null, evidence: '' })
    const a = confirmProposal(p, [task()], LATER)
    const b = confirmProposal(p, [task()], LATER)
    expect(a.ok && a.value.tasks.map((t) => t.state)).toEqual(['dropped', 'open', 'open'])
    expect(a.ok && b.ok && a.value.tasks.map((t) => t.id)).toEqual(b.ok && b.value.tasks.map((t) => t.id))
  })
  it('merge keeps the oldest task with every source and the earliest date; the others are dropped', () => {
    const older = task({ id: 't1', createdAt: '2026-10-10T08:00:00.000Z', sourceEntryIds: ['n1'], due: '2026-10-20' })
    const newer = task({ id: 't2', text: 'Get light bulbs', sourceEntryIds: ['n2'], due: '2026-10-15' })
    const p = proposal({ op: 'merge', taskIds: ['t2', 't1'], basis: ['Get light bulbs', 'Buy bulbs'], text: 'Buy light bulbs', entryId: null, evidence: '' })
    const r = confirmProposal(p, [older, newer], LATER)
    expect(r.ok && r.value.tasks.map((t) => [t.id, t.state])).toEqual([['t1', 'open'], ['t2', 'dropped']])
    expect(r.ok && r.value.tasks[0]).toMatchObject({ text: 'Buy light bulbs', sourceEntryIds: ['n1', 'n2'], due: '2026-10-15' })
  })
  it('a proposal whose task left open is confirmed with no effect; an answered one is refused', () => {
    const r = confirmProposal(proposal({}), [task({ state: 'done' })], LATER)
    expect(r.ok && r.value.tasks).toEqual([])
    expect(confirmProposal(proposal({ state: 'rejected' }), [task()], LATER).ok).toBe(false)
    expect(rejectProposal(proposal({})).ok && rejectProposal(proposal({ state: 'confirmed' })).ok).toBe(false)
  })
})
