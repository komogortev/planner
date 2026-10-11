import { describe, expect, it } from 'vitest'
import type { Applied } from '@/domain/harness'
import { ageLabel, harnessSummary, plainInline, reportLines } from '../report'
import { marksByNote } from '../marks'

describe('reportLines — untrusted model text renders as plain lines', () => {
  it('reads a checklist, bullets, headings and depth', () => {
    expect(reportLines('## Today\n- [ ] call Sam\n  - [x] buy milk\n* note\n\nplain')).toEqual([
      { kind: 'heading', text: 'Today' },
      { kind: 'check', done: false, text: 'call Sam', depth: 0 },
      { kind: 'check', done: true, text: 'buy milk', depth: 1 },
      { kind: 'bullet', text: 'note', depth: 0 },
      { kind: 'text', text: 'plain' },
    ])
  })

  it('negative control: links lose their target, HTML stays literal text', () => {
    expect(plainInline('see [the doc](https://evil.example) and <https://evil.example>')).toBe('see the doc and https://evil.example')
    expect(reportLines('- [ ] <img src=x onerror=alert(1)>')[0]).toMatchObject({ text: '<img src=x onerror=alert(1)>' })
  })
})

describe('harnessSummary', () => {
  it('counts what would be stored and every dropped row by reason', () => {
    const a: Applied = {
      assessments: [{ id: 'a', entryId: 'n', harnessVersion: 1, runId: 'r', at: 'x' }],
      questions: [],
      links: [{ id: 'l', fromEntryId: 'n', toEntryId: 'm', kind: 'closes', onDate: null, state: 'proposed', evidence: 'e', runId: 'r' }],
      dropped: [{ reason: 'unknown-target', entryId: 'z' }, { reason: 'unknown-target', entryId: 'y' }],
    }
    expect(harnessSummary(a, 2)).toEqual(['1 of 2 notes assessed', '0 new questions', '1 proposed close · 0 proposed carries', 'Dropped: unknown-target ×2'])
  })
})

describe('ageLabel', () => {
  it('minutes, hours, days', () => {
    const t = Date.parse('2026-10-11T12:00:00Z')
    expect(ageLabel('2026-10-11T11:55:00Z', t)).toBe('5 min ago')
    expect(ageLabel('2026-10-11T09:00:00Z', t)).toBe('3 h ago')
    expect(ageLabel('2026-10-10T12:00:00Z', t)).toBe('1 day ago')
  })
})

describe('marksByNote', () => {
  const q = (id: string, entryId: string, state: 'open' | 'answered' | 'dismissed', deletedAt: string | null = null) => ({
    id, entryId, text: id, state, answer: state === 'answered' ? 'a' : null, createdAt: 'x', answeredAt: null, runId: 'r', deletedAt,
  })
  const link = (id: string, toEntryId: string, state: 'proposed' | 'confirmed' = 'proposed') => ({
    id, fromEntryId: 'n9', toEntryId, kind: 'closes' as const, onDate: null, state, evidence: 'e', runId: 'r', deletedAt: null,
  })

  it('open questions and proposals per note; answered counted; a plain note is absent', () => {
    const m = marksByNote([q('q1', 'n1', 'open'), q('q2', 'n1', 'answered'), q('q3', 'n2', 'dismissed'), q('q4', 'n1', 'open', 'x')], [link('l1', 'n1'), link('l2', 'n1', 'confirmed')], [])
    expect(m.get('n1')).toMatchObject({ answered: 1, state: null })
    expect(m.get('n1')!.questions.map((x) => x.id)).toEqual(['q1'])
    expect(m.get('n1')!.proposals.map((x) => x.id)).toEqual(['l1'])
    expect(m.has('n2')).toBe(false)
  })

  it('no proposal and no open question is asked on a note that is already done', () => {
    const done = { id: 'n1', state: 'done' as const, followUpOn: null, by: 'owner' as const, updatedAt: 'x', deletedAt: null }
    expect(marksByNote([q('q1', 'n1', 'open')], [link('l1', 'n1')], [done]).get('n1')).toMatchObject({ questions: [], proposals: [], state: { state: 'done' } })
  })
})
