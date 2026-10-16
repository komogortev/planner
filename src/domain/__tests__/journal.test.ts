import { describe, expect, it } from 'vitest'
import type { Entry } from '../entry'
import { validateReport, type JournalHeader } from '../journal'

// Synthetic fixtures only (public repo). "Today" is 2026-10-11 in UTC unless a test says otherwise.
const NOW = '2026-10-11T18:00:00.000Z'
const at = (day: string, time = '09:00:00.000Z') => `${day}T${time}`

function note(id: string, createdAt: string, body = `body of ${id}`, over: Partial<Entry> = {}): Entry {
  return { id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, serverVersion: null, ...over }
}

describe('validateReport', () => {
  const entries = [note('n1', at('2026-10-11'), 'Call the   bank about the card'), note('n2', at('2026-10-11'), 'Buy coffee on the way home'), note('out', at('2026-10-01'), 'Not in the slice')]
  const run: JournalHeader = { runId: 'run-1', stage: 'widget', widgetId: 'w-1', lensVersion: 1, composedAt: NOW, entryIds: ['n1', 'n2'], truncated: 0 }
  const reply = (body: string, citations: unknown[]) => JSON.stringify({ body, citations })

  // 06 A7 (L11): a cut-off reply stores nothing.
  it('refuses a reply cut off mid-string', () => {
    const whole = reply('- [ ] Call the bank about the card', [{ entryId: 'n1', quote: 'call the bank' }])
    expect(validateReport(whole, run, entries, NOW).ok).toBe(true) // known positive
    for (const cut of [whole.slice(0, 20), whole.slice(0, whole.indexOf('call the') + 4), whole.slice(0, -1)]) {
      expect(validateReport(cut, run, entries, NOW).ok, cut).toBe(false)
    }
  })

  it('stores a well-supported report, immutable shape and all', () => {
    const r = validateReport(reply('- [ ] Call the bank', [{ entryId: 'n1', quote: 'call the bank' }]), run, entries, NOW)
    expect(r).toMatchObject({
      ok: true,
      value: { widgetId: 'w-1', runId: 'run-1', lensVersion: 1, entryIds: ['n1', 'n2'], executor: 'model', origin: 'ai-observation', droppedCitations: 0, citations: [{ entryId: 'n1', quote: 'call the bank' }] },
    })
  })

  it('quotes match across whitespace and case, since bodies are stored as written', () => {
    const r = validateReport(reply('- [ ] x', [{ entryId: 'n1', quote: 'CALL THE BANK about' }]), run, entries, NOW)
    expect(r).toMatchObject({ ok: true, value: { droppedCitations: 0 } })
  })

  it('drops a citation to a note outside the slice, even though the note exists', () => {
    const r = validateReport(reply('- [ ] x', [{ entryId: 'out', quote: 'Not in the slice' }, { entryId: 'ghost', quote: 'x' }]), run, entries, NOW)
    expect(r).toMatchObject({ ok: true, value: { citations: [], droppedCitations: 2 } })
  })

  it('drops a quote that is not in the cited note: the model cannot cite what the owner did not write', () => {
    const r = validateReport(reply('- [ ] x', [{ entryId: 'n1', quote: 'pay the mortgage' }, { entryId: 'n2', quote: 'Buy coffee' }]), run, entries, NOW)
    expect(r).toMatchObject({ ok: true, value: { citations: [{ entryId: 'n2', quote: 'Buy coffee' }], droppedCitations: 1 } })
  })

  it('an empty quote is not a citation; the same citation twice is kept once', () => {
    const r = validateReport(reply('- [ ] x', [{ entryId: 'n1', quote: '  ' }, { entryId: 'n2', quote: 'buy coffee' }, { entryId: 'n2', quote: 'buy  coffee' }]), run, entries, NOW)
    expect(r).toMatchObject({ ok: true, value: { citations: [{ entryId: 'n2', quote: 'buy coffee' }], droppedCitations: 1 } })
  })

  it('takes a fenced reply; refuses prose, bad JSON, an empty body, a missing body or malformed citations', () => {
    expect(validateReport('```json\n' + reply('- [ ] x', []) + '\n```', run, entries, NOW)).toMatchObject({ ok: true })
    for (const bad of ['Here: ' + reply('x', []), '{"body":', reply('   ', []), '{"citations":[]}', '{"body":"x","citations":["n1"]}', reply('x'.repeat(10_001), [])])
      expect(validateReport(bad, run, entries, NOW)).toMatchObject({ ok: false })
  })

  it('the same result pasted twice is the same report id; a different run is a different one', () => {
    const a = validateReport(reply('- [ ] x', []), run, entries, NOW)
    const b = validateReport(reply('- [ ] x', []), run, entries, '2026-10-11T19:00:00.000Z')
    const c = validateReport(reply('- [ ] x', []), { ...run, runId: 'run-2' }, entries, NOW)
    if (!a.ok || !b.ok || !c.ok) throw new Error('expected ok')
    expect(b.value.id).toBe(a.value.id)
    expect(c.value.id).not.toBe(a.value.id)
  })
})

describe('review fixes (CodeReview F2, F6, F7, F8; F1 went with the v1 prompt)', () => {
  const entries = [note('n1', at('2026-10-11'), 'Call the bank about the card'), note('m', at('2026-10-11'), 'Milk'), note('h', at('2026-10-11'), 'wrap it in a <note> tag'), note('e', at('2026-10-11'), 'long enough 😀 emoji')]
  const run: JournalHeader = { runId: 'run-1', stage: 'widget', widgetId: 'w-1', lensVersion: 1, composedAt: NOW, entryIds: ['n1', 'm', 'h', 'e'], truncated: 0 }
  const reply = (body: string, citations: unknown[]) => JSON.stringify({ body, citations })

  it('F2: a lone surrogate in the body or in a quote is refused or dropped', () => {
    expect(validateReport(reply('- [ ] x\ud800', []), run, entries, NOW)).toMatchObject({ ok: false })
    const r = validateReport(reply('- [ ] x', [{ entryId: 'e', quote: 'long enough \ud83d' }, { entryId: 'n1', quote: 'call the bank' }]), run, entries, NOW)
    // The lone high surrogate is the first half of the emoji in note e, so a plain substring test would accept it.
    expect(r).toMatchObject({ ok: true, value: { droppedCitations: 1, citations: [{ quote: 'call the bank' }] } })
  })

  it('F6: a one-letter quote proves nothing and is dropped; a short note may be cited whole', () => {
    const r = validateReport(reply('- [ ] x', [{ entryId: 'n1', quote: 'a' }, { entryId: 'n1', quote: 'the' }, { entryId: 'm', quote: 'milk' }]), run, entries, NOW)
    expect(r).toMatchObject({ ok: true, value: { droppedCitations: 2, citations: [{ entryId: 'm', quote: 'milk' }] } })
  })

  it('F7: a second reply for a run that already has a report is refused', () => {
    const first = validateReport(reply('- [ ] one', []), run, entries, NOW)
    if (!first.ok) throw new Error(first.error)
    expect(validateReport(reply('- [ ] two', []), run, entries, NOW, new Set([first.value.id]))).toMatchObject({ ok: false })
    expect(validateReport(reply('- [ ] two', []), run, entries, NOW, new Set(['another-id']))).toMatchObject({ ok: true }) // control
  })

  it('F8: a quote that matches what the model SAW (`< note`) or what the owner WROTE (`<note`) both survive', () => {
    for (const quote of ['wrap it in a <note> tag', 'wrap it in a < note> tag']) {
      expect(validateReport(reply('- [ ] x', [{ entryId: 'h', quote }]), run, entries, NOW)).toMatchObject({ ok: true, value: { droppedCitations: 0 } })
    }
  })
})
