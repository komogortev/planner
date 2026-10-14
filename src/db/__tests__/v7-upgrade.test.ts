// The financial domain is deleted (2026-10-13): a device that holds a v6 database opens it under v7.
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { PlannerDb } from '..'

let n = 0
const NOW = '2026-10-13T12:00:00.000Z'
const FINANCIAL = ['commitments', 'payments', 'intentions', 'marketEntries', 'categories', 'themes', 'themeMembers', 'settings']

/** A database as the v6 build left it: a financial row in every legacy table, the GitHub settings row, and a note. */
async function v6Database(name: string) {
  const old = new Dexie(name)
  old.version(6).stores({
    commitments: 'id, type, startDate, updatedAt, categoryId, *tags',
    payments: 'id, commitmentId, date',
    intentions: 'id, status, updatedAt, categoryId, *tags',
    marketEntries: 'id, intentionId, observedAt, categoryId, *tags',
    settings: 'id',
    categories: 'id, label, sortOrder',
    themes: 'id, label, status, targetDate, updatedAt',
    themeMembers: 'id, themeId, entityId, [themeId+entityType+entityId]',
    entries: 'id, createdAt, occurredAt, categoryId, *tags, updatedAt, serverVersion',
    outbox: '++seq, entityId',
    syncMeta: 'userId',
  })
  await old.open()
  for (const t of FINANCIAL) await old.table(t).put({ id: `${t}-1` })
  await old.table('entries').put({ id: 'n1', body: 'kept', createdAt: NOW, occurredAt: null, categoryId: null, tags: [], origin: 'text', updatedAt: NOW, deletedAt: null, serverVersion: 1 })
  old.close()
}

describe('Dexie v7 upgrade', () => {
  // Known positive: the v6 database really holds a row in every financial table, so "gone afterwards" cannot pass vacuously.
  it('drops the financial tables and the GitHub settings row with their data, and keeps the notes', async () => {
    const name = `upgrade7-${++n}`
    await v6Database(name)
    const check = new Dexie(name)
    await check.open() // dynamic mode: opens whatever schema is on disk
    for (const t of FINANCIAL) expect(await check.table(t).count()).toBe(1)
    check.close()

    const db = new PlannerDb(name)
    await db.open()
    const tables = db.tables.map((t) => t.name)
    for (const t of FINANCIAL) expect(tables).not.toContain(t)
    expect(await db.entries.toArray()).toMatchObject([{ id: 'n1', body: 'kept' }])
    db.close()

    const reopened = new Dexie(name)
    await reopened.open() // what is on disk now, not what PlannerDb declares
    for (const t of FINANCIAL) expect(reopened.tables.map((x) => x.name)).not.toContain(t)
    reopened.close()
  })
})
