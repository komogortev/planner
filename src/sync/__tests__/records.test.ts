// HW-HARNESS S2, client side: records ride the same outbox, push, pull and D-58 sweep as notes — and notes behave exactly as
// before. Two devices against one fake server, synthetic data only.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlannerDb } from '@/db'
import { outboxKey, writeRecords } from '@/db/records'
import { captureEntry } from '@/capture/capture'
import { coalesce, SyncEngine } from '../engine'
import { FakeServer } from './fakeServer'

let n = 0
type Device = { db: PlannerDb; engine: SyncEngine }

function device(server: FakeServer, token = 'tok-a'): Device {
  const db = new PlannerDb(`records-device-${++n}`)
  const engine = new SyncEngine({
    db, fetch: server.fetch as typeof fetch, apiUrl: 'https://api.test', token: () => token, now: () => 1_000_000, online: () => true, yieldNow: async () => {},
  })
  return { db, engine }
}

let server: FakeServer
beforeEach(() => { server = new FakeServer() })

const NOW = '2026-10-11T18:00:00.000Z'
const question = (over: Record<string, unknown> = {}) => ({
  id: `q-${++n}`, entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: NOW, answeredAt: null, runId: 'run-1', ...over,
})
const write = (d: Device, recordKind: 'question' | 'entryState' | 'assessment', row: Record<string, unknown> & { id: string }) =>
  writeRecords(d.db, [{ recordKind, row }], NOW)

describe('push', () => {
  // Known positive: the push really transfers a record, so "outbox empty afterwards" cannot pass on an empty run.
  it('sends a record, clears its outbox row, stamps the local row with the server version', async () => {
    const a = device(server)
    const q = question()
    expect(await write(a, 'question', q)).toEqual({ ok: true, written: 1 })
    expect(await a.db.outbox.toArray()).toMatchObject([{ entityId: `question/${q.id}`, recordKind: 'question', baseVersion: null }])
    await a.engine.run()
    expect(server.records.size).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.questions.get(q.id))!.serverVersion).toBe(1)
    const push = server.requests.find((r) => r.path === '/sync/push')!
    expect((push.body as { mutations: unknown[] }).mutations).toMatchObject([{ recordKind: 'question', entityId: q.id, op: 'upsert', payload: { id: q.id, deletedAt: null } }])
  })

  it('the acknowledgement alone stamps the version (the same cycle’s pull cannot be what does it)', async () => {
    server.sendRecords = false // an older Worker's pull would bring nothing back, so only the push answer can set the version
    const a = device(server)
    await write(a, 'question', question({ id: 'q-ack' }))
    await a.engine.run()
    expect((await a.db.questions.get('q-ack'))!.serverVersion).toBe(1)
  })

  it('a note’s mutation carries no recordKind key: the entry wire form is what it always was', async () => {
    const a = device(server)
    await captureEntry('plain note', a.db)
    await a.engine.run()
    const push = server.requests.find((r) => r.path === '/sync/push')!
    const [m] = (push.body as { mutations: Record<string, unknown>[] }).mutations
    expect(Object.keys(m!).sort()).toEqual(['baseVersion', 'entityId', 'op', 'payload'])
  })

  it('a replay creates no second row: the same change queued again clears as a duplicate', async () => {
    const a = device(server)
    await write(a, 'question', question({ id: 'q-replay' }))
    const row = (await a.db.outbox.toArray())[0]!
    await a.engine.run()
    await a.db.outbox.add({ ...row, seq: undefined })
    await a.engine.run()
    expect(server.records.size).toBe(1)
    expect(server.seq).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('an entry and an entryState with the SAME id are two rows and each gets its own version, not the other’s', async () => {
    const a = device(server)
    const r = await captureEntry('buy coffee', a.db)
    if (!r.ok) throw new Error(r.error)
    await write(a, 'entryState', { id: r.entry.id, state: 'done', followUpOn: null, by: 'owner', updatedAt: NOW })
    expect((await a.db.outbox.toArray()).map((o) => o.entityId).sort()).toEqual([`entryState/${r.entry.id}`, r.entry.id].sort())
    await a.engine.run()
    expect(server.rows.size).toBe(1)
    expect(server.records.size).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.entries.get(r.entry.id))!.serverVersion).toBe(1)
    expect((await a.db.entryStates.get(r.entry.id))!.serverVersion).toBe(2)
  })

  it('coalesce(): queued edits of one record become one mutation — latest payload, earliest base, kind kept, bare id sent', () => {
    const row = (seq: number, base: number | null, text: string) =>
      ({ seq, entityId: 'question/q1', recordKind: 'question', op: 'upsert', baseVersion: base, payload: { id: 'q1', text }, attempts: 0, lastError: null, queuedAt: '' }) as never
    const [g] = coalesce([row(2, 4, 'two'), row(1, 3, 'one')])
    expect(g).toMatchObject({ entityId: 'question/q1', id: 'q1', recordKind: 'question', seqs: [1, 2] })
    expect(g!.mutation).toEqual({ entityId: 'q1', op: 'upsert', baseVersion: 3, payload: { id: 'q1', text: 'two' }, recordKind: 'question' })
  })
})

describe('pull', () => {
  it('a new device receives notes AND records, with their server versions, and counts both', async () => {
    const a = device(server)
    await captureEntry('a note', a.db)
    const q = question({ id: 'q-pulled' })
    await write(a, 'question', q)
    await a.engine.run()

    const b = device(server)
    await b.engine.run()
    expect(await b.db.entries.count()).toBe(1)
    expect(await b.db.questions.toArray()).toMatchObject([{ id: 'q-pulled', text: 'Which shop?', state: 'open', deletedAt: null, serverVersion: 2 }])
    expect(b.engine.state.pulled).toBe(2)
    expect((await b.db.syncMeta.toArray())[0]!.cursor).toBe(2)
  })

  it('notes and records written in turn arrive together under one cursor that ends at the account head', async () => {
    const a = device(server)
    for (const t of ['one', 'two', 'three']) {
      await captureEntry(t, a.db)
      await write(a, 'question', question({ text: `${t}?` }))
    }
    await a.engine.run()
    expect(server.seq).toBe(6)
    const b = device(server)
    await b.engine.run()
    expect(await b.db.entries.count()).toBe(3)
    expect(await b.db.questions.count()).toBe(3)
    expect((await b.db.syncMeta.toArray())[0]!.cursor).toBe(6)
  })

  it('a queued local edit is not overwritten by a pulled copy of the same record', async () => {
    const q = question({ id: 'q-queued' })
    server.seedRecord('question', { ...q, deletedAt: null })
    const b = device(server)
    await write(b, 'question', { ...q, text: 'My unsent wording?' })
    await b.engine.run() // push first: the server has the record at v1, this edit is based on null, so it is applied on top
    const local = (await b.db.questions.get('q-queued'))!
    expect(local.text).toBe('My unsent wording?')
    // Now the negative control: queue an edit, then pull a newer server copy without pushing.
    await b.db.outbox.clear()
    await write(b, 'question', { ...q, text: 'Second unsent wording?' })
    server.seedRecord('question', { ...q, text: 'Someone else’s wording?', deletedAt: null })
    const pushOnly = (b.engine as unknown as { pull: (u: string, g: number) => Promise<void> })
    await pushOnly.pull('user-a', 0)
    expect((await b.db.questions.get('q-queued'))!.text).toBe('Second unsent wording?') // the local edit wins until it is pushed
  })

  it('a malformed record from the server is skipped, the good ones around it are stored, the cursor still moves', async () => {
    server.seedRecord('question', { ...question({ id: 'q-bad', state: 'maybe' }), deletedAt: null }) // not a valid state
    server.seedRecord('question', { ...question({ id: 'q-good' }), deletedAt: null })
    const b = device(server)
    await b.engine.run()
    expect((await b.db.questions.toArray()).map((q) => q.id)).toEqual(['q-good'])
    expect((await b.db.syncMeta.toArray())[0]!.cursor).toBe(2)
    expect(b.engine.state.phase).toBe('idle')
  })

  it('an older Worker that sends no `records` leaves records alone and notes sync as before', async () => {
    const a = device(server)
    await captureEntry('a note', a.db)
    await write(a, 'question', question({ id: 'q-old' }))
    await a.engine.run()
    server.sendRecords = false
    const b = device(server)
    await b.engine.run()
    expect(await b.db.entries.count()).toBe(1)
    expect(await b.db.questions.count()).toBe(0)
    expect(b.engine.state.phase).toBe('idle')
  })
})

describe('rejected records (D-27)', () => {
  it('a refused record is kept and marked, does not block notes, and discarding a never-synced one removes it from the device', async () => {
    const a = device(server)
    const q = question({ id: 'q-refused' })
    server.reject.add(q.id)
    await write(a, 'question', q)
    await captureEntry('fine note', a.db)
    await a.engine.run()
    expect(server.rows.size).toBe(1) // the note went
    const [stuck] = (await a.db.outbox.toArray()).filter((r) => r.rejectedAt)
    expect(stuck).toMatchObject({ entityId: `question/${q.id}`, recordKind: 'question' })
    expect(await a.db.questions.count()).toBe(1) // exercised: there is a local record to lose

    expect(await a.engine.discardRejected()).toBe(1)
    expect(await a.db.questions.count()).toBe(0) // nowhere else it lives
    expect(await a.db.entries.count()).toBe(1) // the note is untouched
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('retrying makes a refused record pending again', async () => {
    const a = device(server)
    const q = question({ id: 'q-retry' })
    server.reject.add(q.id)
    await write(a, 'question', q)
    await a.engine.run()
    server.reject.delete(q.id)
    expect(await a.engine.retryRejected()).toBe(1)
    await a.engine.run()
    expect(server.records.size).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
  })
})

describe('the server went back in time (D-58)', () => {
  // Known positive: before the restore the server really holds the note and the record; after it, neither.
  it('puts back the notes AND the records the server lost', async () => {
    const a = device(server)
    await captureEntry('a note', a.db)
    await write(a, 'question', question({ id: 'q-lost' }))
    await write(a, 'entryState', { id: 'a-note-id', state: 'dropped', followUpOn: null, by: 'owner', updatedAt: NOW })
    await a.engine.run()
    expect(server.rows.size).toBe(1)
    expect(server.records.size).toBe(2)

    server.restoreTo(0) // the database was restored to before any of it
    expect(server.rows.size + server.records.size).toBe(0)
    await a.engine.run()
    expect(server.rows.size).toBe(1)
    expect([...server.records.keys()].sort()).toEqual(['entryState/a-note-id', 'question/q-lost'])
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.questions.get('q-lost'))!.serverVersion).not.toBeNull()
  })

  it('a refused record that stays in the outbox is not requeued by the sweep as well', async () => {
    const a = device(server)
    await captureEntry('a note', a.db)
    await a.engine.run() // cursor 1
    server.reject.add('q-stuck')
    await write(a, 'question', question({ id: 'q-stuck' }))
    await a.engine.run() // refused, kept in the outbox and marked
    server.restoreTo(0) // the sweep will run, with the refused row still waiting
    await a.engine.run()
    const rows = (await a.db.outbox.toArray()).filter((r) => r.recordKind === 'question')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.rejectedAt).toBeTruthy()
  })

  it('only what the server lost is put back: a record it still holds is not sent again', async () => {
    const a = device(server)
    await captureEntry('a note', a.db) // v1
    await write(a, 'question', question({ id: 'q-kept' })) // v2
    await a.engine.run()
    await write(a, 'question', question({ id: 'q-gone' })) // v3
    await a.engine.run()
    expect(server.seq).toBe(3)
    server.restoreTo(2) // v3 is lost; the note and q-kept survive
    server.requests.length = 0
    await a.engine.run()
    expect([...server.records.keys()].sort()).toEqual(['question/q-gone', 'question/q-kept'])
    const sent = server.requests.filter((r) => r.path === '/sync/push').flatMap((r) => (r.body as { mutations: { entityId: string }[] }).mutations.map((m) => m.entityId))
    expect(sent).toEqual(['q-gone']) // exactly the lost one; not the note, not q-kept
  })

  it('a record still waiting in the outbox is not requeued twice by the sweep', async () => {
    const a = device(server)
    await captureEntry('a note', a.db)
    await a.engine.run()
    server.restoreTo(0)
    await write(a, 'question', question({ id: 'q-waiting' })) // written after the restore, never pushed
    await a.engine.run()
    expect(server.records.size).toBe(1)
    expect(server.seq).toBe(2) // the note and the record, once each
  })
})

describe('writeRecords', () => {
  it('refuses a whole write when any record is invalid: nothing is stored, nothing is queued', async () => {
    const a = device(server)
    const res = await writeRecords(a.db, [
      { recordKind: 'question', row: question({ id: 'q-ok' }) },
      { recordKind: 'question', row: question({ id: 'q-bad', state: 'answered' }) }, // answered with no answer
    ], NOW)
    expect(res.ok).toBe(false)
    expect(await a.db.questions.count()).toBe(0)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('writing what the device already holds queues nothing (pasting a result twice)', async () => {
    const a = device(server)
    const q = question({ id: 'q-twice' })
    expect(await write(a, 'question', q)).toEqual({ ok: true, written: 1 })
    expect(await write(a, 'question', q)).toEqual({ ok: true, written: 0 })
    expect(await a.db.outbox.count()).toBe(1)
  })

  it('an edit of a synced record is based on the version the device holds', async () => {
    const a = device(server)
    const q = question({ id: 'q-edit' })
    await write(a, 'question', q)
    await a.engine.run()
    await write(a, 'question', { ...q, state: 'dismissed' })
    expect(await a.db.outbox.toArray()).toMatchObject([{ entityId: outboxKey('question', 'q-edit'), baseVersion: 1, op: 'upsert' }])
  })

  it('a delete is queued as a delete and the row is kept (soft delete), so the delete reaches every device', async () => {
    const a = device(server)
    const q = question({ id: 'q-del' })
    await write(a, 'question', q)
    await a.engine.run()
    await writeRecords(a.db, [{ recordKind: 'question', row: { ...q, deletedAt: NOW } }], NOW)
    expect(await a.db.outbox.toArray()).toMatchObject([{ op: 'delete' }])
    expect((await a.db.questions.get('q-del'))!.deletedAt).toBe(NOW)
  })
})
