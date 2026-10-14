// A6 (D-118): a build older than the device's data must be told apart before Dexie opens anything (src/db/staleBuild.ts).
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { PlannerDb } from '..'
import { isOlderThanData, storedVersion } from '../staleBuild'

let n = 0
const fresh = () => `stale-${++n}`
const listed = async (name: string) => (await indexedDB.databases()).find((d) => d.name === name)?.version ?? null

/** A database as a NEWER build would leave it: PlannerDb's schema plus one more version. */
async function newerDatabase(name: string) {
  const db = new PlannerDb(name)
  db.version(db.verno + 1).stores({ later: 'id' })
  await db.open()
  await db.entries.put({ id: 'n1', body: 'kept' } as never)
  db.close()
}

describe('stale build guard (A6)', () => {
  // Known positive first: a newer database IS reported, so the "opens" cases below cannot pass on a guard that never fires.
  it('reports a device whose data is newer than this build, and reading the version changes nothing', async () => {
    const name = fresh()
    await newerDatabase(name)
    const current = new PlannerDb(name)
    const before = await listed(name)
    expect(before).toBe((current.verno + 1) * 10)
    expect(isOlderThanData(await storedVersion(name), current.verno)).toBe(true)
    expect(await listed(name)).toBe(before) // not bumped, not patched: nothing was opened
  })

  it('this build on its own data, or after a Dexie schema patch (70 → 71), is not older', async () => {
    const name = fresh()
    const db = new PlannerDb(name)
    await db.open()
    db.close()
    expect(isOlderThanData(await storedVersion(name), db.verno)).toBe(false)
    expect(isOlderThanData(db.verno * 10 + 1, db.verno)).toBe(false)
  })

  it('a device with no database yet is not older, and the check does not create one', async () => {
    const name = fresh()
    expect(await storedVersion(name)).toBeNull()
    expect(await listed(name)).toBeNull() // indexedDB.open(name) would have created it at version 1
    expect(isOlderThanData(null, 7)).toBe(false)
  })

  it('a newer build still opens and upgrades data an older build left (the guard blocks only downward)', async () => {
    const name = fresh()
    const old = new Dexie(name)
    old.version(4).stores({ entries: 'id, createdAt, occurredAt, categoryId, *tags, updatedAt, serverVersion', outbox: '++seq, entityId', syncMeta: 'userId' })
    await old.open()
    old.close()
    const db = new PlannerDb(name)
    expect(isOlderThanData(await storedVersion(name), db.verno)).toBe(false)
    await db.open()
    expect(db.idbdb!.version).toBe(db.verno * 10)
    db.close()
  })

  it('a browser without databases() (Firefox before 126) gets null: the app starts as it did before the guard', async () => {
    expect(await storedVersion('x', {} as IDBFactory)).toBeNull()
    const throwing = { databases: () => Promise.reject(new Error('blocked')) } as unknown as IDBFactory
    expect(await storedVersion('x', throwing)).toBeNull()
  })

  it('a databases() that never answers (Safari) gives null within the timeout, so startup is never left blank', async () => {
    const hangs = { databases: () => new Promise(() => {}) } as unknown as IDBFactory
    const t = Date.now()
    expect(await storedVersion('x', hangs, 300)).toBeNull()
    expect(Date.now() - t).toBeLessThan(1_000)
  })

  it('a first call that hangs and a later one that answers: the answer is used (polled like Dexie idbReady)', async () => {
    let calls = 0
    const late = { databases: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve([{ name: 'x', version: 80 }])) } as unknown as IDBFactory
    expect(await storedVersion('x', late, 1_000)).toBe(80)
    expect(calls).toBeGreaterThan(1)
  })

  it('the boundary: 79 (nine patches) is not older than v7, 80 is', () => {
    expect(isOlderThanData(79, 7)).toBe(false)
    expect(isOlderThanData(80, 7)).toBe(true)
  })
})
