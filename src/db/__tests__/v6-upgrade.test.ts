// S3 v2 S2: a device that already holds a v5 database opens it under v6 (HW-HARNESS §11).
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { PlannerDb } from '..'

let n = 0
const NOW = '2026-10-11T18:00:00.000Z'

/** A database as the v5 build left it: a note, a question it pulled with the v2 keys dropped, and a pull cursor past it. */
async function v5Database(name: string, cursor: number) {
  const old = new Dexie(name)
  old.version(4).stores({ entries: 'id, createdAt, occurredAt, categoryId, *tags, updatedAt, serverVersion', outbox: '++seq, entityId', syncMeta: 'userId' })
  old.version(5).stores({
    assessments: 'id, entryId, runId, serverVersion',
    questions: 'id, entryId, state, serverVersion',
    links: 'id, fromEntryId, toEntryId, state, serverVersion',
    entryStates: 'id, state, followUpOn, serverVersion',
    widgets: 'id, kind, active, serverVersion',
    reports: 'id, widgetId, runId, ranAt, serverVersion',
    runs: 'id, stage, ranAt, serverVersion',
  })
  await old.open()
  await old.table('questions').put({ id: 'q1', entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: NOW, answeredAt: null, runId: 'run-1', deletedAt: null, serverVersion: 6 })
  await old.table('syncMeta').put({ userId: 'u1', cursor, lastPushAt: null, lastPullAt: null })
  old.close()
}

describe('Dexie v6 upgrade', () => {
  // Known positive: the v5 database really holds the cursor before the upgrade, so "0 afterwards" cannot pass vacuously.
  it('resets the pull cursor so rows the v5 build skipped or stripped are fetched again, and keeps what it held', async () => {
    const name = `upgrade6-${++n}`
    await v5Database(name, 7)
    const check = new Dexie(name)
    check.version(5).stores({ syncMeta: 'userId', questions: 'id' })
    expect((await check.table('syncMeta').get('u1')).cursor).toBe(7)
    check.close()

    const db = new PlannerDb(name)
    await db.open()
    expect((await db.syncMeta.get('u1'))!.cursor).toBe(0)
    expect(await db.questions.toArray()).toMatchObject([{ id: 'q1', entryId: 'n1', serverVersion: 6 }])
    expect(await db.tasks.count()).toBe(0)
    expect(await db.taskProposals.count()).toBe(0)
    db.close()
  })
})
