import { describe, expect, it } from 'vitest'
import type { Entry } from '../entry'
import { answerQuestion, dismissQuestion, setNoteState } from '../harness'
import { validateReport, type JournalHeader } from '../journal'
import { applyHarness2 } from '../harness2Reply'
import { ADDED_FIELDS, cleanRecord, flatten, isRecordKind, RECORD_DATA_MAX_BYTES, RECORD_KINDS, RECORD_TABLE, restoreAbsent } from '../records'
import { answerRemoval, removalQuestion } from '../summary'
import { addTask, confirmProposal, editTask, rejectProposal, setTaskState, type Task } from '../tasks'

// Synthetic fixtures only (public repo).
const NOW = '2026-10-11T18:00:00.000Z'
const note = (id: string, createdAt: string, body: string): Entry => ({
  id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, serverVersion: null,
})
const withDeleted = <T extends object>(r: T) => ({ ...r, deletedAt: null })

function must(kind: string, input: unknown) {
  const r = cleanRecord(kind, input)
  if (!r.ok) throw new Error(`expected ok, got ${r.errors.join('; ')}`)
  return r.value
}
const errorsOf = (kind: string, input: unknown) => {
  const r = cleanRecord(kind, input)
  return r.ok ? [] : r.errors
}

describe('rows from harness v1 and the v1 journal still pass the validator unchanged (D-113: kept readable, never written)', () => {
  const entries = [note('n1', '2026-10-10T09:00:00.000Z', 'buy coffee'), note('n2', '2026-10-11T08:00:00.000Z', 'had a good coffee')]
  const assessment = { id: 'a-1', entryId: 'n2', harnessVersion: 1, runId: 'run-1', at: NOW }
  const question = { id: 'q-1', entryId: 'n2', text: 'Which shop?', state: 'open' as const, answer: null, createdAt: NOW, answeredAt: null, runId: 'run-1' }
  const closes = { id: 'l-1', fromEntryId: 'n2', toEntryId: 'n1', kind: 'closes', onDate: null, state: 'proposed', evidence: 'had a good coffee', runId: 'run-1' }
  const carries = { id: 'l-2', fromEntryId: 'n2', toEntryId: 'n2', kind: 'carries', onDate: '2026-10-12', state: 'proposed', evidence: '', runId: 'run-1' }

  it('assessment, question, closes and carries links, in every state a link reached', () => {
    expect(flatten(must('assessment', withDeleted(assessment)))).toEqual(withDeleted(assessment))
    expect(flatten(must('question', withDeleted(question)))).toEqual(withDeleted(question))
    for (const l of [closes, carries]) for (const state of ['proposed', 'confirmed', 'rejected']) {
      const row = withDeleted({ ...l, state })
      expect(flatten(must('link', row))).toEqual(row)
    }
  })

  it('every state a question reaches through the owner’s transitions', () => {
    const answered = answerQuestion(question, 'The corner one', NOW)
    const dismissed = dismissQuestion(question)
    if (!answered.ok || !dismissed.ok) throw new Error('transition failed')
    for (const r of [answered.value, dismissed.value]) expect(flatten(must('question', withDeleted(r)))).toEqual(withDeleted(r))
  })

  it('entry states set by the owner, and by a confirmed v1 proposal', () => {
    const byProposal = { id: 'n1', state: 'done', followUpOn: null, by: 'confirmed-proposal', updatedAt: NOW }
    for (const s of [setNoteState('n1', 'done', NOW), setNoteState('n1', 'dropped', NOW), setNoteState('n1', 'open', NOW, '2026-10-20'), setNoteState('n1', 'open', NOW), byProposal])
      expect(flatten(must('entryState', withDeleted(s)))).toEqual(withDeleted(s))
  })

  it('a v1 journal report and the built-in widget row that held the journal lens', () => {
    const run: JournalHeader = { runId: 'run-1', stage: 'widget', widgetId: 'builtin-daily-task-journal', lensVersion: 1, composedAt: NOW, entryIds: ['n1', 'n2'], truncated: 0 }
    const r = validateReport(JSON.stringify({ body: '- [ ] Buy coffee', citations: [{ entryId: 'n1', quote: 'buy coffee' }] }), run, entries, NOW)
    if (!r.ok) throw new Error(r.error)
    const old = { ...r.value, executor: 'copy-prompt' as const }
    expect(flatten(must('report', withDeleted(old)))).toEqual(withDeleted(old))
    const lens = { id: 'builtin-daily-task-journal', name: 'Daily task journal', version: 2, shape: 'checklist', instruction: 'List what the owner committed to do today.' }
    const widget = { id: 'builtin-daily-task-journal', name: lens.name, kind: 'prompt', active: true, lens, lineage: null, createdAt: NOW, updatedAt: NOW }
    expect(flatten(must('widget', withDeleted(widget)))).toEqual(withDeleted(widget))
  })
})

describe('cleanRecord — the rules', () => {
  const question = { id: 'q-1', entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: NOW, answeredAt: null, runId: 'run-1', deletedAt: null }

  it('every kind has a table; an unknown kind is refused', () => {
    expect(Object.keys(RECORD_TABLE).sort()).toEqual([...RECORD_KINDS].sort())
    expect(isRecordKind('question')).toBe(true)
    expect(isRecordKind('entry')).toBe(false) // entries have their own path
    expect(errorsOf('entry', question)).toEqual(['recordKind: unknown'])
    expect(errorsOf(undefined, question)).toEqual(['recordKind: unknown'])
  })

  it('fixed field order and lowercased ids: equal content serialises equally', () => {
    const shuffled = { runId: 'run-1', deletedAt: null, answeredAt: null, answer: null, state: 'open', text: 'Which shop?', entryId: 'N1', createdAt: NOW, id: 'Q-1' }
    const a = must('question', shuffled)
    expect(JSON.stringify(a.fields)).toBe(JSON.stringify(must('question', question).fields))
    expect(a.id).toBe('q-1')
    expect(a.fields.entryId).toBe('n1')
  })

  it('a missing key is an error, never a default (an absent deletedAt must not undelete)', () => {
    const { deletedAt: _d, ...noDeleted } = question
    const { answer: _a, ...noAnswer } = question
    expect(errorsOf('question', noDeleted)).toEqual(['deletedAt: missing'])
    expect(errorsOf('question', noAnswer)).toEqual(['answer: missing'])
  })

  it('drops unknown keys; refuses a non-object payload', () => {
    expect(must('question', { ...question, serverVersion: 9, owner: 'x' }).fields).not.toHaveProperty('serverVersion')
    expect(errorsOf('question', null)).toEqual(['payload: not an object'])
    expect(errorsOf('question', [question])).toEqual(['payload: not an object'])
  })

  it('cleans text the way the domain does, and is idempotent', () => {
    const once = must('question', { ...question, text: '  Which\u0007   shop?\n' })
    expect(once.fields.text).toBe('Which shop?')
    expect(must('question', { id: once.id, ...once.fields, deletedAt: null }).fields).toEqual(once.fields)
  })

  it('refuses a lone surrogate, an over-long field, a bad date, an unknown enum', () => {
    expect(errorsOf('question', { ...question, text: 'x\ud800' })).toEqual(['text: is not text'])
    expect(errorsOf('question', { ...question, text: 'x'.repeat(201) })).toEqual(['text: must be 1–200 characters'])
    expect(errorsOf('question', { ...question, createdAt: '2026-10-11' })).toEqual(['createdAt: is not a UTC date-time'])
    expect(errorsOf('question', { ...question, state: 'maybe' })).toEqual(['state: must be one of open, answered, dismissed'])
    expect(errorsOf('question', { ...question, id: 'Not An Id!' })).toEqual(['id: is not an id'])
  })

  it('counts characters by code point: 200 emoji fit, 201 do not', () => {
    expect(errorsOf('link', { id: 'l', fromEntryId: 'a', toEntryId: 'b', kind: 'closes', onDate: null, state: 'proposed', evidence: '😀'.repeat(200), runId: 'r', deletedAt: null })).toEqual([])
    expect(errorsOf('link', { id: 'l', fromEntryId: 'a', toEntryId: 'b', kind: 'closes', onDate: null, state: 'proposed', evidence: '😀'.repeat(201), runId: 'r', deletedAt: null })).toHaveLength(1)
  })

  it('cross-field rules: question, link, entryState, widget, run', () => {
    expect(errorsOf('question', { ...question, state: 'answered' })).toHaveLength(1) // answered without an answer
    expect(errorsOf('question', { ...question, answer: 'x' })).toHaveLength(1) // open with an answer
    const link = { id: 'l', fromEntryId: 'a', toEntryId: 'b', kind: 'closes', onDate: null, state: 'proposed', evidence: 'x', runId: 'r', deletedAt: null }
    expect(errorsOf('link', { ...link, onDate: '2026-10-12' })).toHaveLength(1) // a close with a date
    expect(errorsOf('link', { ...link, kind: 'carries' })).toHaveLength(1) // a carry without one
    const state = { id: 'n1', state: 'done', followUpOn: '2026-10-12', by: 'owner', updatedAt: NOW, deletedAt: null }
    expect(errorsOf('entryState', state)).toHaveLength(1)
    const widget = { id: 'w', name: 'W', kind: 'prompt', active: true, lens: null, lineage: null, createdAt: NOW, updatedAt: NOW, deletedAt: null }
    expect(errorsOf('widget', widget)).toHaveLength(1)
    expect(errorsOf('widget', { ...widget, kind: 'system' })).toEqual([])
    expect(errorsOf('run', { id: 'r', stage: 'widget', version: 1, widgetId: null, entryIds: [], ranAt: NOW, executor: 'copy-prompt', deletedAt: null })).toHaveLength(1)
  })

  it('bounds the stored size', () => {
    const citations = Array.from({ length: 200 }, (_, i) => ({ entryId: `n${i}`, quote: 'q'.repeat(200) }))
    const big = { id: 'r1', widgetId: 'w', lensVersion: 1, runId: 'r', entryIds: [], body: 'x'.repeat(10_000), citations, executor: 'copy-prompt', ranAt: NOW, origin: 'ai-observation', droppedCitations: 0, deletedAt: null }
    expect(JSON.stringify(big).length).toBeGreaterThan(RECORD_DATA_MAX_BYTES - 20_000) // near the ceiling, as a sanity check
    expect(errorsOf('report', big)).toEqual([]) // 10 KB body + 200 × 200-char quotes still fits
    expect(errorsOf('report', { ...big, entryIds: Array.from({ length: 201 }, (_, i) => `n${i}`) })).toHaveLength(1)
  })
})

// ── S3 v2 S2: the Worker contract for Tasks (HW-HARNESS §11, D-74) ─────────────────────────────────────────────────

describe('the S3 v2 S1 → S2 contract: every record the v2 domain produces passes the validator unchanged', () => {
  const t = (id: string, text: string, sourceEntryIds: string[], over: Partial<Task> = {}): Task => ({
    id, text, sourceEntryIds, due: null, state: 'open', followUpOn: null, by: 'harness', editedAt: null, runId: 'run-0', createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-10T08:00:00.000Z', ...over,
  })
  const entries = [note('n0', '2026-10-10T07:00:00.000Z', 'bulbs, plumber'), note('n1', '2026-10-11T08:00:00.000Z', 'bought the bulbs'), note('n2', '2026-10-11T09:00:00.000Z', 'the tap and the boiler')]
  const tasks = [t('t1', 'Buy bulbs', ['n0']), t('t2', 'Fix the tap', ['n0']), t('t3', 'Call about tap and boiler', ['n0']), t('t4', 'Paint the door', ['n0']), t('t5', 'Paint the gate', ['n0'])]
  const applied = applyHarness2(
    {
      tasks: [
        { op: 'create', ref: null, text: 'Book the plumber', sourceEntryIds: ['n2'], due: '2026-10-15' },
        { op: 'attach', taskId: 't2', sourceEntryIds: ['n2'], due: null },
        { op: 'close', taskId: 't1', entryId: 'n1', evidence: 'bought the bulbs' },
        { op: 'revise', taskId: 't2', text: 'Fix the kitchen tap', due: null },
        { op: 'split', taskId: 't3', into: [{ text: 'Call about the tap', sourceEntryIds: ['n2'] }, { text: 'Call about the boiler', sourceEntryIds: ['n2'] }] },
        { op: 'merge', taskIds: ['t4', 't5'], text: 'Paint the door and the gate' },
      ],
      questions: [{ taskId: 't2', entryId: null, text: 'Which tap?' }, { taskId: null, entryId: 'n2', text: 'Is the boiler urgent?' }],
    },
    { runId: 'run-1', composedAt: NOW, toAssessIds: ['n1', 'n2'], contextIds: ['n0'], reevaluateIds: [], taskIds: tasks.map((x) => x.id) },
    { entries, assessments: [], questions: [], tasks, proposals: [], states: [] },
    NOW, 'UTC',
  )
  const same = (kind: string, r: object) => expect(flatten(must(kind, withDeleted(r))), kind).toEqual(withDeleted(r))

  // Known positive: the fixture really produces every op and both question subjects, so "all pass" is not vacuous.
  it('tasks, the four proposal ops, task and note questions, task and note assessments', () => {
    expect(applied.dropped).toEqual([])
    expect(applied.proposals.map((p) => p.op).sort()).toEqual(['close', 'merge', 'revise', 'split'])
    expect(applied.questions.map((q) => (q.taskId ? 'task' : 'note')).sort()).toEqual(['note', 'task'])
    expect(applied.tasks.length).toBeGreaterThanOrEqual(2) // the created one and the one whose sources grew
    for (const r of applied.tasks) same('task', r)
    for (const r of applied.proposals) same('taskProposal', r)
    for (const r of applied.questions) same('question', r)
    for (const r of applied.assessments) same('assessment', r)
  })

  it('every state the owner moves a task or a proposal to', () => {
    const added = addTask('00000000-0000-4000-8000-000000000001', 'Water the plants', '2026-10-12', NOW)
    if (!added.ok) throw new Error(added.error)
    const edited = editTask(added.value, { text: 'Water the garden' }, NOW)
    const carried = setTaskState(tasks[0]!, 'open', NOW, '2026-10-13')
    const done = setTaskState(tasks[0]!, 'done', NOW)
    if (!edited.ok || !carried.ok || !done.ok) throw new Error('transition failed')
    for (const r of [added.value, edited.value, carried.value, done.value]) same('task', r)
    for (const p of applied.proposals) {
      const c = confirmProposal(p, [...tasks, ...applied.tasks], NOW)
      if (c.ok) expect(c.value.tasks.length, p.op).toBeGreaterThan(0) // the effect path, not the no-op for a task gone meanwhile
      const r = rejectProposal(p)
      if (!c.ok || !r.ok) throw new Error(`answer failed: ${p.op}`)
      same('taskProposal', c.value.proposal)
      same('taskProposal', r.value)
      for (const x of c.value.tasks) same('task', x)
    }
  })

  it('a split part citing more notes than a task may hold is capped, so the proposal and its confirmed tasks still store', () => {
    const many = Array.from({ length: 200 }, (_, i) => `m${i}`)
    const big = t('t6', 'Sort the paperwork', many)
    const r = applyHarness2(
      { tasks: [{ op: 'split', taskId: 't6', into: [{ text: 'Sort the bills', sourceEntryIds: [...many, 'n1'] }, { text: 'Sort the letters', sourceEntryIds: ['m0'] }] }], questions: [] },
      { runId: 'run-2', composedAt: NOW, toAssessIds: ['n1'], contextIds: [], reevaluateIds: [], taskIds: ['t6'] },
      { entries, assessments: [], questions: [], tasks: [big], proposals: [], states: [] },
      NOW, 'UTC',
    )
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0]!.parts[0]!.sourceEntryIds).toHaveLength(200)
    same('taskProposal', r.proposals[0]!)
    const c = confirmProposal(r.proposals[0]!, [big], NOW)
    if (!c.ok) throw new Error(c.error)
    for (const x of c.value.tasks) same('task', x)
  })

  it('the removal question the summary writes, open and answered', () => {
    const q = removalQuestion(tasks[0]!, '2026-10-11', NOW)
    same('question', q)
    const a = answerRemoval(q, tasks[0]!, 'drop', NOW)
    if (!a.ok) throw new Error(a.error)
    same('question', a.value.question)
    if (a.value.task) same('task', a.value.task)
  })

  it('a v2 harness run carrying its task ids', () => {
    same('run', { id: 'run-1', stage: 'harness', version: 2, widgetId: null, entryIds: ['n1'], ranAt: NOW, executor: 'copy-prompt', taskIds: ['t1', 't2'] })
  })
})

describe('H5: a run made by a registered model (H5-MODELS §5)', () => {
  const base = { id: 'r', stage: 'harness', version: 2, widgetId: null, entryIds: ['n1'], ranAt: NOW, taskIds: [], deletedAt: null }
  it('names its model and call; a copy-prompt run names neither; an older build has neither key', () => {
    expect(must('run', { ...base, executor: 'model', modelId: 'm1', callId: 'c-1' }).absent).toEqual([]) // known positive
    expect(must('run', { ...base, executor: 'copy-prompt', modelId: null, callId: null }).absent).toEqual([])
    expect(must('run', { ...base, executor: 'copy-prompt' }).absent).toEqual(['modelId', 'callId'])
    expect(errorsOf('run', { ...base, executor: 'model', modelId: 'm1', callId: null })).toEqual(['a model run names its model and call'])
    expect(errorsOf('run', { ...base, executor: 'model' })).toEqual(['a model run names its model and call'])
    expect(errorsOf('run', { ...base, executor: 'copy-prompt', modelId: 'm1', callId: 'c-1' })).toEqual(['a copy-prompt run names no model or call'])
    expect(errorsOf('run', { ...base, executor: 'api' })).toHaveLength(1)
  })
})

describe('rows from before tasks (ADDED_FIELDS)', () => {
  const v1 = { id: 'q-1', entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: NOW, answeredAt: null, runId: 'run-1', deletedAt: null }
  const v2 = { ...v1, taskId: null, kind: 'harness' }

  it('an older build\'s question, assessment and run are accepted with the keys absent, and kept absent, never defaulted', () => {
    const q = must('question', v1)
    expect(q.absent).toEqual(['taskId', 'kind'])
    expect(flatten(q)).toEqual(v1) // no `taskId: null` added: the stored text stays what that build would replay
    expect(must('assessment', { id: 'a', entryId: 'n1', harnessVersion: 1, runId: 'r', at: NOW, deletedAt: null }).absent).toEqual(['taskId'])
    expect(must('run', { id: 'r', stage: 'harness', version: 1, widgetId: null, entryIds: [], ranAt: NOW, executor: 'copy-prompt', deletedAt: null }).absent).toEqual(['taskIds', 'modelId', 'callId'])
    expect(must('question', v2).absent).toEqual([])
  })

  it('only the added keys may be absent', () => {
    const { text: _t, ...noText } = v2
    expect(errorsOf('question', noText)).toEqual(['text: missing'])
    expect(ADDED_FIELDS.task).toBeUndefined() // a new kind has no older rows: every key is required
  })

  it('exactly one subject; an older row names its note; taskId and kind come together; a removal is about a task', () => {
    expect(errorsOf('question', { ...v2, entryId: null })).toEqual(['names a note or a task, exactly one'])
    expect(errorsOf('question', { ...v2, taskId: 't1' })).toEqual(['names a note or a task, exactly one'])
    expect(errorsOf('question', { ...v2, entryId: null, taskId: 't1' })).toEqual([])
    expect(errorsOf('question', { ...v1, entryId: null })).toEqual(['a row from before tasks names its note'])
    const { kind: _k, ...noKind } = v2
    expect(errorsOf('question', noKind)).toEqual(['taskId and kind come together'])
    expect(errorsOf('question', { ...v2, kind: 'removal' })).toEqual(['a removal question is about a task'])
    const a = { id: 'a', entryId: 'n1', taskId: null, harnessVersion: 2, runId: 'r', at: NOW, deletedAt: null }
    expect(errorsOf('assessment', a)).toEqual([])
    expect(errorsOf('assessment', { ...a, taskId: 't1' })).toEqual(['names a note or a task, exactly one'])
    expect(errorsOf('assessment', { ...a, entryId: null })).toEqual(['names a note or a task, exactly one'])
  })

  it('restoreAbsent: a key the push lacks takes the stored value; a present key stays the push\'s; the result is re-validated', () => {
    const pushed = must('question', { ...v1, state: 'answered', answer: 'the corner one', answeredAt: NOW })
    const stored = JSON.stringify(must('question', v2).fields)
    const r = restoreAbsent(pushed, stored)
    if (!r.ok) throw new Error(r.errors.join('; '))
    expect(flatten(r.value)).toEqual({ ...v2, state: 'answered', answer: 'the corner one', answeredAt: NOW })
    expect(JSON.stringify(r.value.fields)).toBe(JSON.stringify(must('question', flatten(r.value)).fields)) // spec order kept
    expect(restoreAbsent(must('question', v2), JSON.stringify({ taskId: 't9', kind: 'removal' }))).toEqual({ ok: true, value: must('question', v2) })
    expect(restoreAbsent(pushed, JSON.stringify(must('question', v1).fields))).toEqual({ ok: true, value: pushed }) // stored row is old too
    expect(restoreAbsent(pushed, JSON.stringify({ taskId: 't9', kind: 'harness' })).ok).toBe(false) // note AND task: refused
  })
})

describe('task and taskProposal rules', () => {
  const task = { id: 't1', text: 'Buy bulbs', sourceEntryIds: ['n1'], due: null, state: 'open', followUpOn: null, by: 'harness', editedAt: null, runId: 'run-1', createdAt: NOW, updatedAt: NOW, deletedAt: null }
  const close = { id: 'p1', op: 'close', taskIds: ['t1'], basis: ['Buy bulbs'], text: null, due: null, parts: [], entryId: 'n2', evidence: 'bought them', state: 'proposed', runId: 'run-1', createdAt: NOW, deletedAt: null }
  const base = { ...close, entryId: null, evidence: '' }
  const parts = [{ text: 'A', sourceEntryIds: ['n1'] }, { text: 'B', sourceEntryIds: ['n2'] }]

  it('a task: only an open one carries a follow-up date; owner text has an edit time; every key is required', () => {
    expect(errorsOf('task', task)).toEqual([])
    expect(errorsOf('task', { ...task, state: 'done', followUpOn: '2026-10-12' })).toEqual(['only an open task carries a follow-up date'])
    expect(errorsOf('task', { ...task, by: 'owner' })).toEqual(['owner text has an edit time'])
    const { runId: _r, ...noRun } = task
    expect(errorsOf('task', noRun)).toEqual(['runId: missing'])
  })

  it('each proposal op has its own shape, and the fields it does not use are empty', () => {
    expect(errorsOf('taskProposal', close)).toEqual([])
    expect(errorsOf('taskProposal', { ...close, evidence: '' })).toHaveLength(1)
    expect(errorsOf('taskProposal', { ...close, text: 'x' })).toHaveLength(1)
    expect(errorsOf('taskProposal', { ...base, op: 'revise', text: 'Buy LED bulbs' })).toEqual([])
    expect(errorsOf('taskProposal', { ...base, op: 'revise' })).toHaveLength(1) // nothing to revise
    expect(errorsOf('taskProposal', { ...base, op: 'split', parts })).toEqual([])
    expect(errorsOf('taskProposal', { ...base, op: 'split', parts: parts.slice(0, 1) })).toHaveLength(1)
    expect(errorsOf('taskProposal', { ...base, op: 'split', parts: [parts[0], { text: 'B', sourceEntryIds: [] }] })).toHaveLength(1)
    const merge = { ...base, op: 'merge', taskIds: ['t1', 't2'], basis: ['A', 'B'], text: 'A and B' }
    expect(errorsOf('taskProposal', merge)).toEqual([])
    expect(errorsOf('taskProposal', { ...merge, taskIds: ['t1', 't1'] })).toHaveLength(1)
    expect(errorsOf('taskProposal', { ...merge, basis: ['A'] })).toHaveLength(1)
    expect(errorsOf('taskProposal', { ...merge, text: null })).toHaveLength(1)
    expect(errorsOf('taskProposal', { ...merge, taskIds: ['t1'], basis: ['A'] })).toHaveLength(1)
  })
})
