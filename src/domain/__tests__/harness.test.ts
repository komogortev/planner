import { describe, expect, it } from 'vitest'
import { addDays, answerQuestion, dismissQuestion, localDay, normalizeQuestion, type Question, setNoteState } from '../harness'

// The shared harness helpers and the owner's transitions. Harness v1's selection, prompt and reply tests went with their
// code (D-113, R4); harness v2's are in harness2.test.ts. Synthetic fixtures only: the repo is public (HW-HARNESS.md §8).
const NOW = '2026-10-11T18:00:00.000Z'
const question = (over: Partial<Question>): Question => ({
  id: 'q-1', entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: NOW, answeredAt: null, runId: 'run-0', ...over,
})

describe('dates', () => {
  it('localDay follows the zone, not UTC (known positive for the zone argument)', () => {
    expect(localDay('2026-10-11T03:30:00.000Z', 'UTC')).toBe('2026-10-11')
    expect(localDay('2026-10-11T03:30:00.000Z', 'America/Toronto')).toBe('2026-10-10')
  })
  it('addDays crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-10-11', -11)).toBe('2026-09-30')
  })
})

describe('normalizeQuestion', () => {
  it('ignores case, spacing and trailing punctuation, nothing else', () => {
    expect(normalizeQuestion('  Which   SHOP?? ')).toBe('which shop')
    expect(normalizeQuestion('Which shop')).toBe('which shop')
    expect(normalizeQuestion('Which store?')).not.toBe('which shop') // negative control
  })
})

describe('the owner’s side', () => {
  it('answerQuestion stores the owner’s text; refuses empty, over-long and already-closed', () => {
    expect(answerQuestion(question({}), '  The corner one \u0007', NOW)).toMatchObject({ ok: true, value: { state: 'answered', answer: 'The corner one', answeredAt: NOW } })
    expect(answerQuestion(question({}), '   ', NOW)).toMatchObject({ ok: false })
    expect(answerQuestion(question({}), 'x'.repeat(2001), NOW)).toMatchObject({ ok: false })
    expect(answerQuestion(question({ state: 'dismissed' }), 'hi', NOW)).toMatchObject({ ok: false })
  })

  it('dismissQuestion closes an open question once', () => {
    const r = dismissQuestion(question({}))
    expect(r).toMatchObject({ ok: true, value: { state: 'dismissed' } })
    expect(dismissQuestion(question({ state: 'answered' }))).toMatchObject({ ok: false })
  })

  it('setNoteState: a follow-up date only travels with open', () => {
    expect(setNoteState('n1', 'done', NOW, '2026-10-12')).toMatchObject({ state: 'done', followUpOn: null, by: 'owner' })
    expect(setNoteState('n1', 'open', NOW, '2026-10-12')).toMatchObject({ state: 'open', followUpOn: '2026-10-12' })
  })
})
