import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { recordTables } from '@/db/records'
import type { Entry } from '@/domain/entry'
import { JOURNAL_LENS } from '@/domain/journal'
import { clearDeviceSafely } from '@/auth/account'
import { answer, applyHarnessReply, applyJournalReply, confirm, loadHarnessData, markNote, pendingHarness, pendingJournal, startHarness, startJournal } from '../loop'
import { loadPending, savePending } from '../pending'

// The suite runs in node: a minimal localStorage (the pending run lives there, like the capture draft).
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
})

// Synthetic fixtures only (public repo). Midday UTC, so "today" is the same calendar day in any zone from −11 to +11.
const NOW = '2026-10-11T12:30:00.000Z'
const LATER = '2026-10-11T12:40:00.000Z'
const note = (id: string, createdAt: string, body = `body of ${id}`): Entry => ({
  id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, serverVersion: 1,
})
const OLD = 'a0000000-0000-4000-8000-000000000001'
const NEW = 'a0000000-0000-4000-8000-000000000002'

const reply = (o: unknown) => JSON.stringify(o)
const harnessReply = reply({
  assessments: [
    { entryId: OLD, questions: [{ text: 'Which shop?' }], closes: [], followUp: { entryId: OLD, on: '2026-10-14' } },
    { entryId: NEW, questions: [], closes: [{ entryId: OLD, evidence: 'bought the milk' }], followUp: null },
  ],
})
const counts = async () => ({
  assessments: await db.assessments.count(),
  questions: await db.questions.count(),
  links: await db.links.count(),
  runs: await db.runs.count(),
  reports: await db.reports.count(),
  outbox: await db.outbox.count(),
})
const NOTHING = { assessments: 0, questions: 0, links: 0, runs: 0, reports: 0, outbox: 0 }

beforeEach(async () => {
  localStorage.clear()
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), ...recordTables(db).map((t) => t.clear())])
  await db.entries.bulkPut([note(OLD, '2026-10-11T11:00:00.000Z', 'buy milk'), note(NEW, '2026-10-11T12:00:00.000Z', 'bought the milk')])
})

describe('stage 1 on the device', () => {
  it('nothing to assess: no prompt and nothing waiting', async () => {
    await db.entries.clear()
    expect(await startHarness(NOW)).toBeNull()
    expect(pendingHarness()).toBeNull()
  })

  it('the composed header waits in storage (survives a reload) and holds ids and times only', async () => {
    const c = (await startHarness(NOW))!
    expect(c.header.toAssessIds).toEqual([OLD, NEW])
    const raw = store.get('planner.run.pending.harness')!
    expect(JSON.parse(raw)).toEqual(c.header)
    expect(raw).not.toContain('milk') // no note text in the stored header
  })

  it('negative control: a checked reply stores nothing until Store', async () => {
    await startHarness(NOW)
    const r = await applyHarnessReply(harnessReply, { store: false, now: LATER })
    expect(r).toMatchObject({ ok: true, value: { written: 0 } })
    if (r.ok) expect(r.value.applied.questions).toHaveLength(1)
    expect(await counts()).toEqual(NOTHING)
    expect(pendingHarness()).not.toBeNull()
  })

  it('Store writes the surviving rows and the run in one go, each with an outbox row, and stops waiting', async () => {
    await startHarness(NOW)
    const r = await applyHarnessReply(harnessReply, { store: true, now: LATER })
    expect(r.ok).toBe(true)
    expect(await counts()).toEqual({ assessments: 2, questions: 1, links: 2, runs: 1, reports: 0, outbox: 6 })
    expect((await db.runs.toArray())[0]).toMatchObject({ stage: 'harness', widgetId: null, entryIds: [OLD, NEW], ranAt: NOW })
    expect(pendingHarness()).toBeNull()
  })

  it('replaying the same reply for the same run stores nothing more (acceptance d)', async () => {
    const c = (await startHarness(NOW))!
    await applyHarnessReply(harnessReply, { store: true, now: LATER })
    const before = await counts()
    savePending('harness', c.header) // the same run waiting again, e.g. a second device holding the same prompt
    const again = await applyHarnessReply(harnessReply, { store: true, now: LATER })
    expect(again).toMatchObject({ ok: true, value: { written: 0 } })
    expect(await counts()).toEqual(before)
  })

  it('no waiting run, or a reply that is not JSON: refused, nothing written', async () => {
    expect(await applyHarnessReply(harnessReply, { store: true })).toMatchObject({ ok: false })
    await startHarness(NOW)
    expect(await applyHarnessReply('Sure! Here are some questions.', { store: true })).toMatchObject({ ok: false })
    expect(await counts()).toEqual(NOTHING)
  })

  it('a stale preview cannot store more than a fresh check: a note done since the check is not assessed', async () => {
    await startHarness(NOW)
    const preview = await applyHarnessReply(harnessReply, { store: false, now: LATER })
    if (preview.ok) expect(preview.value.applied.assessments).toHaveLength(2)
    await markNote(OLD, 'done', null, LATER) // between Check and Store (another tap, or a sync)
    const stored = await applyHarnessReply(harnessReply, { store: true, now: LATER })
    expect(stored.ok && stored.value.applied.dropped.map((d) => d.reason)).toContain('note-not-open')
    expect((await db.assessments.toArray()).map((a) => a.entryId)).toEqual([NEW])
    expect(await db.questions.count()).toBe(0) // the question was on the note that is now done
  })

  it('storage that refuses the header: compose throws and nothing waits (the reply could never be checked)', async () => {
    const real = localStorage.setItem
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      await expect(startHarness(NOW)).rejects.toThrow(/refused to store the run/)
      await expect(startJournal(NOW)).rejects.toThrow(/refused to store the run/)
    } finally {
      localStorage.setItem = real
    }
    expect(pendingHarness()).toBeNull()
  })

  it('a stored header without its id lists is ignored, never trusted', () => {
    store.set('planner.run.pending.harness', JSON.stringify({ stage: 'harness', runId: 'x', composedAt: NOW }))
    expect(loadPending('harness')).toBeNull()
    store.set('planner.run.pending.widget', JSON.stringify({ stage: 'widget', runId: 'x', composedAt: NOW, entryIds: [1] }))
    expect(loadPending('widget')).toBeNull()
  })

  it('a stored value of the wrong stage, or not JSON, is ignored, never trusted', () => {
    store.set('planner.run.pending.harness', JSON.stringify({ stage: 'widget', runId: 'x', composedAt: NOW }))
    expect(loadPending('harness')).toBeNull()
    store.set('planner.run.pending.harness', '{not json')
    expect(loadPending('harness')).toBeNull()
  })

  it('answering a question puts its note back into the next run (acceptance a)', async () => {
    await startHarness(NOW)
    await applyHarnessReply(harnessReply, { store: true, now: LATER })
    expect(await startHarness('2026-10-11T12:50:00.000Z')).toBeNull() // everything assessed
    const q = (await db.questions.toArray())[0]!
    expect((await answer(q, 'The corner one', '2026-10-11T13:00:00.000Z')).ok).toBe(true)
    const next = (await startHarness('2026-10-11T13:10:00.000Z'))!
    expect(next.header.toAssessIds).toEqual([OLD])
    expect(next.prompt).toContain('A: The corner one')
  })
})

describe('v2 rows on a device still running the v1 loop (S3 v2 S3)', () => {
  it('a Task question or assessment is invisible to v1; the S3a note rows are not', async () => {
    const base = { state: 'open', answer: null, createdAt: NOW, answeredAt: null, runId: 'r2', deletedAt: null, serverVersion: 1 } as const
    await db.questions.bulkPut([
      { id: 'q-task', entryId: null, taskId: 't1', kind: 'harness', text: 'Which bulb?', ...base },
      { id: 'q-note', entryId: OLD, text: 'Which shop?', ...base },
    ])
    await db.assessments.bulkPut([
      { id: 'a-task', entryId: null, taskId: 't1', harnessVersion: 2, runId: 'r2', at: NOW, deletedAt: null, serverVersion: 1 },
      { id: 'a-note', entryId: NEW, harnessVersion: 1, runId: 'r1', at: NOW, deletedAt: null, serverVersion: 1 },
    ])
    const d = await loadHarnessData()
    expect(d.questions.map((q) => q.id)).toEqual(['q-note'])
    expect(d.assessments.map((a) => a.id)).toEqual(['a-note'])
    expect((await startHarness(NOW))?.prompt).toContain('Which shop?')
  })
})

describe('the owner confirms, and the journal follows', () => {
  it('confirming a close marks the older note done and it leaves the journal (acceptance b)', async () => {
    await startHarness(NOW)
    await applyHarnessReply(harnessReply, { store: true, now: LATER })
    const close = (await db.links.toArray()).find((l) => l.kind === 'closes')!
    expect((await confirm(close, LATER)).ok).toBe(true)
    expect(await db.entryStates.get(OLD)).toMatchObject({ state: 'done', by: 'confirmed-proposal' })
    expect((await startJournal(LATER))!.header.entryIds).toEqual([NEW])
  })

  it('a note carried to tomorrow is not in today’s journal (acceptance c, first half)', async () => {
    await markNote(NEW, 'open', '2026-10-12', LATER)
    expect((await startJournal(LATER))!.header.entryIds).toEqual([OLD])
  })
})

describe('stage 2 on the device', () => {
  const report = (quote = 'buy milk') => reply({ body: '- [ ] buy milk', citations: [{ entryId: OLD, quote }] })

  it('stores the report and its run once; a second reply for the same run is refused (reports are immutable)', async () => {
    const j = (await startJournal(NOW))!
    expect(pendingJournal()).not.toBeNull()
    const r = await applyJournalReply(report(), { store: true, now: LATER })
    expect(r).toMatchObject({ ok: true, value: { report: { widgetId: JOURNAL_LENS.id, droppedCitations: 0 } } })
    expect(await counts()).toMatchObject({ reports: 1, runs: 1, outbox: 2 })
    savePending('widget', j.header)
    expect(await applyJournalReply(report(), { store: true, now: LATER })).toMatchObject({ ok: false })
    expect(await counts()).toMatchObject({ reports: 1, runs: 1, outbox: 2 })
  })

  it('a report the record validator would refuse fails at Check, not after it (over 200 citations)', async () => {
    // 201 distinct quotes that all occur in the note (identical ones are deduped, so each pair of words is its own quote)
    await db.entries.put(note(OLD, '2026-10-11T11:00:00.000Z', Array.from({ length: 210 }, (_, i) => `item${i}`).join(' ')))
    const j = (await startJournal(NOW))!
    expect(j.header.entryIds).toContain(OLD)
    const r = await applyJournalReply(reply({ body: '- [ ] x', citations: Array.from({ length: 201 }, (_, i) => ({ entryId: OLD, quote: `item${i} item${i + 1}`.slice(0, 40) })) }), { store: false, now: LATER })
    expect(r).toMatchObject({ ok: false })
    expect(await counts()).toEqual(NOTHING)
  })

  it('a citation the note does not support is dropped and flags the report', async () => {
    await startJournal(NOW)
    const r = await applyJournalReply(report('call the bank'), { store: false, now: LATER })
    expect(r).toMatchObject({ ok: true, value: { report: { droppedCitations: 1, citations: [] } } })
  })
})

describe('clearing the device', () => {
  it('drops a waiting run with the account’s tables', async () => {
    savePending('harness', { runId: 'r', stage: 'harness', harnessVersion: 1, composedAt: NOW, toAssessIds: [], contextIds: [], remaining: 0 })
    savePending('widget', { runId: 'w', stage: 'widget', widgetId: JOURNAL_LENS.id, lensVersion: 1, composedAt: NOW, entryIds: [], truncated: 0 })
    expect(await clearDeviceSafely({ confirm: () => true, saveCopy: () => {} })).toBe('cleared')
    expect(pendingHarness()).toBeNull()
    expect(pendingJournal()).toBeNull()
  })
})
