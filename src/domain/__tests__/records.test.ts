import { describe, expect, it } from 'vitest'
import type { Entry } from '../entry'
import { answerQuestion, applyHarness, confirmLink, dismissQuestion, rejectLink, setNoteState } from '../harness'
import { JOURNAL_LENS, validateReport, type JournalHeader } from '../journal'
import { cleanRecord, flatten, isRecordKind, RECORD_DATA_MAX_BYTES, RECORD_KINDS, RECORD_TABLE } from '../records'

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

describe('the S1 → S2 contract: every record the domain produces passes the validator unchanged', () => {
  const entries = [note('n1', '2026-10-10T09:00:00.000Z', 'buy coffee'), note('n2', '2026-10-11T08:00:00.000Z', 'had a good coffee')]
  const data = { entries, assessments: [], questions: [], links: [], states: [] }
  const applied = applyHarness(
    {
      assessments: [
        { entryId: 'n2', questions: [{ text: 'Which shop?' }], closes: [{ entryId: 'n1', evidence: 'had a good coffee' }], followUp: { entryId: 'n2', on: '2026-10-12' } },
      ],
    },
    { runId: 'run-1', toAssessIds: ['n2'], contextIds: ['n1'], composedAt: NOW }, data, NOW, 'UTC',
  )

  it('assessment, question, closes and carries links as the harness proposes them', () => {
    expect(applied.assessments).toHaveLength(1)
    expect(applied.questions).toHaveLength(1)
    expect(applied.links.map((l) => l.kind).sort()).toEqual(['carries', 'closes'])
    for (const a of applied.assessments) expect(flatten(must('assessment', withDeleted(a)))).toEqual(withDeleted(a))
    for (const q of applied.questions) expect(flatten(must('question', withDeleted(q)))).toEqual(withDeleted(q))
    for (const l of applied.links) expect(flatten(must('link', withDeleted(l)))).toEqual(withDeleted(l))
  })

  it('every state a question and a link can reach through the owner’s transitions', () => {
    const q = applied.questions[0]!
    const answered = answerQuestion(q, 'The corner one', NOW)
    const dismissed = dismissQuestion(q)
    if (!answered.ok || !dismissed.ok) throw new Error('transition failed')
    for (const r of [answered.value, dismissed.value]) expect(flatten(must('question', withDeleted(r)))).toEqual(withDeleted(r))
    for (const l of applied.links) {
      const rejected = rejectLink(l)
      const confirmed = confirmLink(l, [], NOW)
      if (!rejected.ok || !confirmed.ok) throw new Error('transition failed')
      expect(flatten(must('link', withDeleted(rejected.value)))).toEqual(withDeleted(rejected.value))
      expect(flatten(must('link', withDeleted(confirmed.value.link)))).toEqual(withDeleted(confirmed.value.link))
      if (confirmed.value.state) expect(flatten(must('entryState', withDeleted(confirmed.value.state)))).toEqual(withDeleted(confirmed.value.state))
    }
  })

  it('entry states set by the owner', () => {
    for (const s of [setNoteState('n1', 'done', NOW), setNoteState('n1', 'dropped', NOW), setNoteState('n1', 'open', NOW, '2026-10-20'), setNoteState('n1', 'open', NOW)])
      expect(flatten(must('entryState', withDeleted(s)))).toEqual(withDeleted(s))
  })

  it('a journal report, and the built-in widget that holds the journal lens', () => {
    const run: JournalHeader = { runId: 'run-1', stage: 'widget', widgetId: JOURNAL_LENS.id, lensVersion: 1, composedAt: NOW, entryIds: ['n1', 'n2'], truncated: 0 }
    const r = validateReport(JSON.stringify({ body: '- [ ] Buy coffee', citations: [{ entryId: 'n1', quote: 'buy coffee' }] }), run, entries, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(flatten(must('report', withDeleted(r.value)))).toEqual(withDeleted(r.value))
    const widget = { id: 'builtin-daily-task-journal', name: JOURNAL_LENS.name, kind: 'prompt', active: true, lens: JOURNAL_LENS, lineage: null, createdAt: NOW, updatedAt: NOW }
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
