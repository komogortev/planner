import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { recordTables } from '@/db/records'
import type { Entry } from '@/domain/entry'
import type { Task } from '@/domain/tasks'
import { SUMMARY_LENS } from '@/domain/summaryLens'
import { clearDeviceSafely } from '@/auth/account'
import { NO_MODEL_REPLY } from '../loop2'
import { applySummaryReply, pendingSummary, startSummary } from '../summaryRun'
import { loadPending, pendingRunId, savePending } from '../pending'

// The Summary's brief on the device (R3), end to end through Dexie and the pending slot. Ported from the v1 journal's
// device tests when D-113 removed it (R4): the store-once, model-executor, check-time and clear rules moved with it.

// The suite runs in node: a minimal localStorage (the pending run lives there).
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
const NOTE = 'a0000000-0000-4000-8000-000000000001'
const VIA = { modelId: 'm1', callId: 'c-1' }
const note = (id: string, body: string): Entry => ({
  id, body, createdAt: '2026-10-11T09:00:00.000Z', occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: '2026-10-11T09:00:00.000Z', deletedAt: null, serverVersion: 1,
})
const doneToday: Task & { deletedAt: null } = {
  id: 'b0000000-0000-4000-8000-000000000001', text: 'Buy milk', sourceEntryIds: [NOTE], due: null, state: 'done', followUpOn: null, by: 'harness',
  editedAt: null, runId: 'r0', createdAt: '2026-10-10T09:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z', deletedAt: null,
}
const brief = (quote = 'buy milk') => JSON.stringify({ body: '- Milk is done.', citations: [{ entryId: NOTE, quote }] })
const counts = async () => ({ reports: await db.reports.count(), runs: await db.runs.count(), outbox: await db.outbox.count() })

beforeEach(async () => {
  store.clear()
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), ...recordTables(db).map((t) => t.clear())])
  await db.entries.put(note(NOTE, 'buy milk on the way home'))
  await db.tasks.put(doneToday)
})

describe('the brief on the device', () => {
  it('stores the report and its run once, as a model run; a second reply for the same run is refused (immutable)', async () => {
    const s = (await startSummary(NOW))!
    expect(pendingSummary()?.runId).toBe(s.header.runId)
    const r = await applySummaryReply(brief(), { store: true, now: LATER, via: VIA })
    expect(r).toMatchObject({ ok: true, value: { report: { widgetId: SUMMARY_LENS.id, executor: 'model', droppedCitations: 0 } } })
    expect((await db.runs.toArray())[0]).toMatchObject({ executor: 'model', modelId: 'm1', callId: 'c-1', widgetId: SUMMARY_LENS.id })
    expect(await counts()).toEqual({ reports: 1, runs: 1, outbox: 2 })
    expect(pendingSummary()).toBeNull()
    savePending('widget', s.header)
    expect(await applySummaryReply(brief(), { store: true, now: LATER, via: VIA })).toMatchObject({ ok: false })
    expect(await counts()).toEqual({ reports: 1, runs: 1, outbox: 2 })
  })

  it('D-113: a reply that did not come from a model is checked but never stored', async () => {
    await startSummary(NOW)
    expect(await applySummaryReply(brief(), { store: false, now: LATER })).toMatchObject({ ok: true }) // known positive: it checks
    expect(await applySummaryReply(brief(), { store: true, now: LATER })).toEqual({ ok: false, error: NO_MODEL_REPLY })
    expect(await counts()).toEqual({ reports: 0, runs: 0, outbox: 0 })
  })

  it('a citation the note does not support is dropped and flags the brief', async () => {
    await startSummary(NOW)
    const r = await applySummaryReply(brief('call the bank'), { store: false, now: LATER })
    expect(r).toMatchObject({ ok: true, value: { report: { droppedCitations: 1, citations: [] } } })
  })

  it('a brief the record validator would refuse fails at Check, not after it (over 200 citations)', async () => {
    await db.entries.put(note(NOTE, Array.from({ length: 210 }, (_, i) => `item${i}`).join(' ')))
    await startSummary(NOW)
    const many = Array.from({ length: 201 }, (_, i) => ({ entryId: NOTE, quote: `item${i} item${i + 1}`.slice(0, 40) }))
    expect(await applySummaryReply(JSON.stringify({ body: '- x', citations: many }), { store: false, now: LATER })).toMatchObject({ ok: false })
    expect(await counts()).toEqual({ reports: 0, runs: 0, outbox: 0 })
  })

  it('review M1 on the device: a reply checked on a later day is refused and the run stops waiting', async () => {
    await startSummary(NOW)
    const r = await applySummaryReply(brief(), { store: true, now: '2026-10-12T12:30:00.000Z', via: VIA })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('earlier day') })
    expect(pendingSummary()).toBeNull()
    expect(await counts()).toEqual({ reports: 0, runs: 0, outbox: 0 })
  })

  it('storage that refuses the header: compose throws and nothing waits (the reply could never be checked)', async () => {
    const real = localStorage.setItem
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      await expect(startSummary(NOW)).rejects.toThrow(/refused to store the run/)
    } finally {
      localStorage.setItem = real
    }
    expect(pendingSummary()).toBeNull()
  })
})

describe('the pending slot', () => {
  it('a stored header without its id list, of the wrong stage, or not JSON, is ignored, never trusted', () => {
    store.set('planner.run.pending.widget', JSON.stringify({ stage: 'widget', runId: 'x', composedAt: NOW, entryIds: [1] }))
    expect(loadPending('widget')).toBeNull()
    store.set('planner.run.pending.widget', JSON.stringify({ stage: 'harness', runId: 'x', composedAt: NOW, entryIds: [] }))
    expect(loadPending('widget')).toBeNull()
    store.set('planner.run.pending.widget', '{not json')
    expect(loadPending('widget')).toBeNull()
    expect(pendingRunId('widget')).toBeNull()
  })

  it('clearing the device drops a waiting run with the account’s tables', async () => {
    await startSummary(NOW)
    expect(pendingSummary()).not.toBeNull()
    expect(await clearDeviceSafely({ confirm: () => true, saveCopy: () => {} })).toBe('cleared')
    expect(pendingSummary()).toBeNull()
  })
})
