// HW-HARNESS S2: a device that already holds a v4 database (notes, an outbox, a pull cursor) opens it under v5.
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { PlannerDb } from '..'

let n = 0

/** A database as the v4 build left it: only what v5 must carry over, written through the same IndexedDB schema versions. */
async function v4Database(name: string, cursor: number) {
  const old = new Dexie(name)
  old.version(4).stores({ entries: 'id, createdAt, occurredAt, categoryId, *tags, updatedAt, serverVersion', outbox: '++seq, entityId', syncMeta: 'userId' })
  await old.open()
  await old.table('entries').put({
    id: 'n1', body: 'a note written on v4', createdAt: '2026-10-10T08:00:00.000Z', occurredAt: null, categoryId: null, tags: [], origin: 'author',
    updatedAt: '2026-10-10T08:00:00.000Z', deletedAt: null, serverVersion: 5,
  })
  await old.table('syncMeta').put({ userId: 'u1', cursor, lastPushAt: null, lastPullAt: null })
  old.close()
}

describe('Dexie v5 upgrade', () => {
  // Known positive: the v4 database really holds the cursor before the upgrade, so "0 afterwards" cannot pass vacuously.
  it('resets the pull cursor so records the older build skipped are fetched, and keeps the notes', async () => {
    const name = `upgrade-${++n}`
    await v4Database(name, 7)
    const check = new Dexie(name)
    check.version(4).stores({ entries: 'id', outbox: '++seq', syncMeta: 'userId' })
    expect((await check.table('syncMeta').get('u1')).cursor).toBe(7)
    check.close()

    const db = new PlannerDb(name)
    await db.open()
    expect((await db.syncMeta.get('u1'))!.cursor).toBe(0)
    expect(await db.entries.toArray()).toMatchObject([{ id: 'n1', body: 'a note written on v4', serverVersion: 5 }])
    for (const t of [db.assessments, db.questions, db.links, db.entryStates, db.widgets, db.reports, db.runs]) expect(await t.count(), t.name).toBe(0)
    db.close()
  })

  it('a database created fresh at v5 is not touched by the upgrade step', async () => {
    const db = new PlannerDb(`fresh-${++n}`)
    await db.syncMeta.put({ userId: 'u1', cursor: 9, lastPushAt: null, lastPullAt: null })
    db.close()
    const again = new PlannerDb(db.name)
    await again.open()
    expect((await again.syncMeta.get('u1'))!.cursor).toBe(9) // reopening at the same version runs no upgrade
    again.close()
  })
})
