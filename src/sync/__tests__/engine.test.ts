import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlannerDb } from '@/db'
import { captureEntry } from '@/capture/capture'
import { backoffDelay, BACKOFF_MAX_MS, coalesce, PULL_PAGE, PUSH_BATCH_BYTES, PUSH_BATCH_MAX, SyncEngine, takeBatch } from '../engine'
import { FakeServer } from './fakeServer'

let n = 0
type Device = { db: PlannerDb; engine: SyncEngine; token: { v: string | null }; clock: { t: number }; online: { v: boolean } }

function device(server: FakeServer, token: string | null = 'tok-a'): Device {
  const db = new PlannerDb(`device-${++n}`)
  const state = { v: token }
  const clock = { t: 1_000_000 }
  const online = { v: true }
  const engine = new SyncEngine({
    db, fetch: server.fetch as typeof fetch, apiUrl: 'https://api.test', token: () => state.v, now: () => clock.t, online: () => online.v, yieldNow: async () => {},
  })
  return { db, engine, token: state, clock, online }
}

let server: FakeServer
beforeEach(() => { server = new FakeServer() })

const bodies = async (d: Device) => (await d.db.entries.orderBy('createdAt').toArray()).map((e) => e.body)

describe('push', () => {
  // Known positive: the push really transfers something, so "outbox empty afterwards" cannot pass on an empty run.
  it('sends a captured entry, clears its outbox row, records the server version', async () => {
    const a = device(server)
    const r = await captureEntry('hello', a.db)
    expect(r.ok).toBe(true)
    expect(await a.db.outbox.count()).toBe(1)
    await a.engine.run()
    expect(server.rows.size).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.entries.toArray())[0]!.serverVersion).toBe(1)
    expect(a.engine.state.phase).toBe('idle')
    expect(a.engine.state.lastSyncedAt).not.toBeNull()
  })

  it('a replayed push creates no second row (the server answers duplicate and the row still clears)', async () => {
    const a = device(server)
    await captureEntry('once', a.db)
    const row = (await a.db.outbox.toArray())[0]!
    await a.engine.run()
    await a.db.outbox.add({ ...row, seq: undefined }) // the same change again, as after a lost response
    await a.engine.run()
    expect(server.rows.size).toBe(1)
    expect(server.seq).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('coalesces queued edits of one entity: latest payload, earliest base, all rows cleared', async () => {
    const a = device(server)
    await captureEntry('v1', a.db)
    await a.engine.run()
    const e = (await a.db.entries.toArray())[0]!
    for (const [i, body] of ['v2', 'v3', 'v4'].entries()) {
      await a.db.outbox.add({ entityId: e.id, op: 'upsert', baseVersion: e.serverVersion, payload: { ...e, body, serverVersion: undefined } as never, attempts: 0, lastError: null, queuedAt: String(i) })
    }
    server.requests.length = 0
    await a.engine.run()
    const push = server.requests.find((r) => r.path === '/sync/push')!
    const mutations = (push.body as { mutations: { baseVersion: number; payload: { body: string } }[] }).mutations
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({ baseVersion: 1, payload: { body: 'v4' } })
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('coalesce(): one group per entity in first-seen order, base from the first row', () => {
    const row = (seq: number, entityId: string, base: number | null, body: string) =>
      ({ seq, entityId, op: 'upsert', baseVersion: base, payload: { id: entityId, body }, attempts: 0, lastError: null, queuedAt: '' }) as never
    const groups = coalesce([row(3, 'b', null, 'b1'), row(1, 'a', 2, 'a1'), row(2, 'a', 3, 'a2')])
    expect(groups.map((g) => g.entityId)).toEqual(['a', 'b'])
    expect(groups[0]!.mutation).toMatchObject({ baseVersion: 2, payload: { body: 'a2' } })
    expect(groups[0]!.seqs).toEqual([1, 2])
  })

  it('splits a flush into requests of at most 50 mutations', async () => {
    const a = device(server)
    for (let i = 0; i < 120; i++) await captureEntry(`note ${i}`, a.db)
    await a.engine.run()
    const pushes = server.requests.filter((r) => r.path === '/sync/push')
    expect(pushes.length).toBe(3)
    for (const p of pushes) expect((p.body as { mutations: unknown[] }).mutations.length).toBeLessThanOrEqual(PUSH_BATCH_MAX)
    expect(server.rows.size).toBe(120)
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('splits by size too: no request body over 100 KB, however few mutations', async () => {
    const a = device(server)
    for (let i = 0; i < 12; i++) await captureEntry(`${i} ` + 'x'.repeat(19_000), a.db) // 12 × ~19 KB
    await a.engine.run()
    const pushes = server.requests.filter((r) => r.path === '/sync/push')
    expect(pushes.length).toBeGreaterThan(2)
    for (const p of pushes) expect(new TextEncoder().encode(JSON.stringify(p.body)).length).toBeLessThanOrEqual(PUSH_BATCH_BYTES)
    expect(server.rows.size).toBe(12)
  })

  it('takeBatch always takes at least one group, even when it alone is over the size bound', () => {
    const big = { entityId: 'x', seqs: [1], mutation: { entityId: 'x', op: 'upsert', baseVersion: null, payload: { body: 'y'.repeat(PUSH_BATCH_BYTES + 5) } } } as never
    expect(takeBatch([big])).toHaveLength(1)
  })

  it('an edit queued while the push was in flight is re-based on the version just acknowledged', async () => {
    const a = device(server)
    await captureEntry('first', a.db)
    const e = (await a.db.entries.toArray())[0]!
    const realFetch = server.fetch
    let injected = false
    const engine = new SyncEngine({
      db: a.db, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true, yieldNow: async () => {},
      fetch: (async (...args: Parameters<typeof fetch>) => {
        const res = await realFetch(...args)
        if (!injected && String(args[0]).endsWith('/sync/push')) {
          injected = true // the owner edits while the answer is on its way back
          await a.db.outbox.add({ entityId: e.id, op: 'upsert', baseVersion: null, payload: { ...e, body: 'edited', serverVersion: undefined } as never, attempts: 0, lastError: null, queuedAt: 'later' })
        }
        return res
      }) as typeof fetch,
    })
    await engine.run()
    expect(server.rows.get(e.id)!.body).toBe('edited') // the edit went out in the same run
    const sent = server.requests.filter((r) => r.path === '/sync/push').map((r) => (r.body as { mutations: { baseVersion: number | null }[] }).mutations[0]!.baseVersion)
    expect(sent).toEqual([null, 1]) // the second push carries the version the first one earned, not the old null
  })
})

describe('failures never lose the outbox', () => {
  it('401 (D-04): rows kept, phase auth, token untouched, no retry loop; a new token flushes them', async () => {
    const a = device(server, 'stale')
    await captureEntry('written while signed out', a.db)
    await a.engine.run()
    expect(a.engine.state.phase).toBe('auth')
    expect(a.token.v).toBe('stale')
    expect(await a.db.outbox.count()).toBe(1)
    const calls = server.requests.length
    await a.engine.run() // a poll tick: no new request while the owner has not acted
    expect(server.requests.length).toBe(calls)
    a.token.v = 'tok-a' // signed in again
    a.engine.reset()
    await a.engine.run()
    expect(a.engine.state.phase).toBe('idle')
    expect(await a.db.outbox.count()).toBe(0)
    expect(server.rows.size).toBe(1)
  })

  it('401 account-deleted: phase account-deleted, rows kept, nothing more is sent', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    server.script.push(() => FakeServer.json({ error: 'signed out', reason: 'account-deleted' }, 401))
    await a.engine.run()
    expect(a.engine.state.phase).toBe('account-deleted')
    expect(await a.db.outbox.count()).toBe(1)
    const calls = server.requests.length
    await a.engine.run()
    expect(server.requests.length).toBe(calls)
  })

  it('429 waits for Retry-After and keeps the rows; force overrides the wait', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    server.script.push(() => FakeServer.json({ error: 'slow down' }, 429, { 'Retry-After': '17' })) // /me
    await a.engine.run()
    expect(a.engine.state.phase).toBe('waiting')
    expect(a.engine.state.retryAt).toBe(a.clock.t + 17_000)
    expect(await a.db.outbox.count()).toBe(1)
    const calls = server.requests.length
    await a.engine.run() // inside the wait: nothing sent
    expect(server.requests.length).toBe(calls)
    a.clock.t += 17_001
    await a.engine.run()
    expect(a.engine.state.phase).toBe('idle')
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('a server error backs off 2 s, 4 s, 8 s … capped at 5 min, and a good cycle resets it', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    const delays: number[] = []
    for (let i = 0; i < 3; i++) {
      server.script.push(() => FakeServer.json({ error: 'boom' }, 500))
      await a.engine.run({ force: true })
      delays.push(a.engine.state.retryAt! - a.clock.t)
    }
    expect(delays).toEqual([2_000, 4_000, 8_000])
    expect(backoffDelay(1)).toBe(2_000)
    expect(backoffDelay(30)).toBe(BACKOFF_MAX_MS)
    await a.engine.run({ force: true })
    expect(a.engine.state).toMatchObject({ phase: 'idle', failures: 0, retryAt: null })
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('a network failure (fetch rejects) is a failure, not a crash, and keeps the rows', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    const engine = new SyncEngine({ db: a.db, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true, now: () => a.clock.t, fetch: (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch })
    await engine.run()
    expect(engine.state).toMatchObject({ phase: 'waiting', lastError: 'Failed to fetch', failures: 1 })
    expect(await a.db.outbox.count()).toBe(1)
  })

  it('offline: no request at all, phase offline, rows kept', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    a.online.v = false
    await a.engine.run()
    expect(a.engine.state.phase).toBe('offline')
    expect(server.requests).toHaveLength(0)
    expect(await a.db.outbox.count()).toBe(1)
  })

  it('a retry answer keeps the row, counts the attempt and backs off', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    const id = (await a.db.entries.toArray())[0]!.id
    server.retryOnce.add(id)
    await a.engine.run()
    expect(a.engine.state.phase).toBe('waiting')
    const row = (await a.db.outbox.toArray())[0]!
    expect(row.attempts).toBe(1)
    await a.engine.run({ force: true })
    expect(await a.db.outbox.count()).toBe(0)
  })
})

describe('a rejected change (D-27)', () => {
  it('is skipped, kept and marked; everything behind it still goes; it is not retried by itself', async () => {
    const a = device(server)
    await captureEntry('poison', a.db)
    await captureEntry('fine 1', a.db)
    await captureEntry('fine 2', a.db)
    const poison = (await a.db.entries.orderBy('createdAt').first())!
    server.reject.add(poison.id)
    await a.engine.run()
    expect(server.rows.size).toBe(2)
    const left = await a.db.outbox.toArray()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ entityId: poison.id, lastError: 'body: refused by the test server' })
    expect(left[0]!.rejectedAt).toBeTruthy()
    expect(a.engine.state.phase).toBe('idle')
    const pushes = server.count('/sync/push')
    await a.engine.run()
    expect(server.count('/sync/push')).toBe(pushes) // a rejected row is not offered again
  })

  it('retryRejected puts the row back in the queue; once the server accepts, it clears', async () => {
    const a = device(server)
    await captureEntry('poison', a.db)
    const id = (await a.db.entries.toArray())[0]!.id
    server.reject.add(id)
    await a.engine.run()
    expect(await a.engine.retryRejected()).toBe(1)
    server.reject.delete(id)
    await a.engine.run()
    expect(await a.db.outbox.count()).toBe(0)
    expect(server.rows.has(id)).toBe(true)
  })

  it('discardRejected drops the row and, for a note the server never had, the note on this device too', async () => {
    const a = device(server)
    await captureEntry('poison', a.db)
    const id = (await a.db.entries.toArray())[0]!.id
    server.reject.add(id)
    await a.engine.run()
    expect(await a.db.entries.count()).toBe(1) // exercised: there is a local note to lose
    expect(await a.engine.discardRejected()).toBe(1)
    expect(await a.db.outbox.count()).toBe(0)
    expect(await a.db.entries.count()).toBe(0)
  })

  // Review finding D: a discarded EDIT must not leave the refused text on the device, and the server version (which a pull
  // skipped while the row existed) must come back.
  it('discarding a refused edit drops the local copy and pulls the server version back', async () => {
    const a = device(server)
    await captureEntry('kept', a.db)
    await a.engine.run()
    const e = (await a.db.entries.toArray())[0]!
    await a.db.entries.update(e.id, { body: 'bad edit' }) // the owner edited it locally...
    await a.db.outbox.add({ entityId: e.id, op: 'upsert', baseVersion: e.serverVersion, payload: { ...e, body: 'bad edit', serverVersion: undefined } as never, attempts: 0, lastError: 'no', queuedAt: 'x', rejectedAt: 'now' })
    server.seed(e.id, 'the other device text') // ...while another device changed it, which the pull skipped
    await a.engine.run() // pull sees an outbox row for e.id: skips, cursor moves
    expect((await a.db.entries.get(e.id))!.body).toBe('bad edit')
    expect(await a.engine.discardRejected()).toBe(1)
    expect(await a.db.entries.get(e.id)).toBeUndefined()
    expect(await a.db.outbox.count()).toBe(0)
    await a.engine.run()
    expect((await a.db.entries.get(e.id))!.body).toBe('the other device text')
  })
})

describe('pull', () => {
  it('a second device receives what the first captured (the slice acceptance)', async () => {
    const a = device(server)
    const b = device(server)
    await captureEntry('from the phone', a.db)
    await a.engine.run()
    expect(await bodies(b)).toEqual([]) // exercised: b really starts empty
    await b.engine.run()
    expect(await bodies(b)).toEqual(['from the phone'])
    expect((await b.db.entries.toArray())[0]!.serverVersion).toBe(1)
    expect((await b.db.syncMeta.toArray())[0]).toMatchObject({ userId: 'user-a', cursor: 1 })
  })

  it('pages of 100, resumable cursor, and a new device can capture while the first pull runs (D-29)', async () => {
    for (let i = 0; i < 250; i++) server.seed(`s-${String(i).padStart(3, '0')}`, `old ${i}`, `2026-10-10T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`)
    const b = device(server)
    let capturedMidPull = false
    const engine = new SyncEngine({
      db: b.db, fetch: server.fetch as typeof fetch, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true,
      yieldNow: async () => { // between two pages the owner captures a note
        if (!capturedMidPull) { capturedMidPull = true; await captureEntry('written during the first pull', b.db) }
      },
    })
    await engine.run()
    const pulls = server.requests.filter((r) => r.path.startsWith('/sync/pull'))
    expect(pulls).toHaveLength(3)
    expect(pulls[0]!.path).toContain(`limit=${PULL_PAGE}`)
    expect(engine.state.pulled).toBe(250)
    expect(await b.db.entries.count()).toBe(251) // the note written mid-pull is there, not lost to the pull
    expect(await b.db.outbox.count()).toBe(1) // and queued; this cycle had already pushed, so it goes in the next one
    await engine.run()
    expect(server.rows.size).toBe(251)
    expect(await b.db.outbox.count()).toBe(0)
  })

  it('does not overwrite an entity that still has a local outbox row; the cursor moves past it', async () => {
    const a = device(server)
    await captureEntry('local text', a.db)
    const id = (await a.db.entries.toArray())[0]!.id
    server.seed(id, 'server text') // another device pushed the same id first
    server.reject.add(id) // our own row stays in the outbox (rejected rows are local edits too)
    await a.engine.run()
    expect((await a.db.entries.get(id))!.body).toBe('local text')
    expect((await a.db.syncMeta.toArray())[0]!.cursor).toBe(1)
    // Negative control: with no outbox row the same server change IS applied.
    await a.engine.discardRejected()
    server.seed(id, 'newer server text')
    await a.engine.run()
    expect((await a.db.entries.get(id))!.body).toBe('newer server text') // discard freed the id; now the pull applies it
  })

  it('a stuck cursor (more=true, no progress) ends the cycle instead of looping', async () => {
    const a = device(server)
    server.script.push(() => FakeServer.json({ id: 'user-a' })) // /me
    server.script.push(() => FakeServer.json({ changes: [], cursor: 0, more: true }))
    await a.engine.run()
    expect(a.engine.state.lastError).toContain('cursor did not advance')
    expect(a.engine.state.phase).toBe('waiting')
  })
})

describe('another account on this device (D-50)', () => {
  it('sends and pulls nothing, keeps the rows, says so', async () => {
    const a = device(server)
    await a.db.syncMeta.put({ userId: 'user-OTHER', cursor: 5, lastPushAt: null, lastPullAt: null })
    await captureEntry("someone else's note", a.db)
    await a.engine.run()
    expect(a.engine.state.phase).toBe('foreign-account')
    expect(server.count('/sync/push')).toBe(0)
    expect(server.count('/sync/pull')).toBe(0)
    expect(server.rows.size).toBe(0)
    expect(await a.db.outbox.count()).toBe(1)
  })

  // Negative control: the same state with the matching account does sync, so the guard is what stopped it above.
  it('the same device state with the matching account syncs normally', async () => {
    const a = device(server)
    await a.db.syncMeta.put({ userId: 'user-a', cursor: 0, lastPushAt: null, lastPullAt: null })
    await captureEntry('mine', a.db)
    await a.engine.run()
    expect(a.engine.state.phase).toBe('idle')
    expect(server.rows.size).toBe(1)
  })
})

describe('review findings', () => {
  // A: a request arriving mid-cycle must not walk past a Retry-After.
  it('a trigger that arrives during a cycle ending in 429 does not start another round', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    let nudged = false
    server.script.push(() => {
      if (!nudged) { nudged = true; void a.engine.run() } // the 2 s timer or the poll fires while this request is in flight
      return FakeServer.json({ error: 'slow' }, 429, { 'Retry-After': '30' })
    })
    await a.engine.run()
    expect(a.engine.state.phase).toBe('waiting')
    expect(server.requests).toHaveLength(1) // exactly one request, not a second hit on the limited endpoint
    // Negative control: after a good cycle the same mid-cycle trigger DOES earn one more round.
    server.requests.length = 0
    a.clock.t += 31_000
    let again = false
    const real = server.fetch
    const spy = new SyncEngine({
      db: a.db, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true, now: () => a.clock.t, yieldNow: async () => {},
      fetch: (async (...args: Parameters<typeof fetch>) => {
        if (!again) { again = true; await captureEntry('written mid-cycle', a.db); void spy.run() }
        return real(...args)
      }) as typeof fetch,
    })
    await spy.run()
    expect(await a.db.outbox.count()).toBe(0) // both notes went, the second in the extra round
  })

  // B: a wipe while a cycle is in flight must win; the late cycle writes nothing back.
  it('a cycle that is mid-pull when the device is reset writes nothing afterwards', async () => {
    server.seed('late-1', 'from the old account')
    const a = device(server)
    const real = server.fetch
    const engine = new SyncEngine({
      db: a.db, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true, yieldNow: async () => {},
      fetch: (async (...args: Parameters<typeof fetch>) => {
        const res = await real(...args)
        if (String(args[0]).includes('/sync/pull')) engine.reset() // sign-out lands while the page is on its way
        return res
      }) as typeof fetch,
    })
    await engine.run()
    expect(server.count('/sync/pull')).toBe(1) // exercised: the pull really happened
    expect(await a.db.entries.count()).toBe(0)
    expect((await a.db.syncMeta.toArray()).every((m) => m.cursor === 0)).toBe(true)
  })

  it('a push acknowledged after the device was reset records nothing on the device', async () => {
    const a = device(server)
    await captureEntry('x', a.db)
    const real = server.fetch
    const engine = new SyncEngine({
      db: a.db, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true, yieldNow: async () => {},
      fetch: (async (...args: Parameters<typeof fetch>) => {
        const res = await real(...args)
        if (String(args[0]).includes('/sync/push')) engine.reset() // the wipe lands while the answer is on its way back
        return res
      }) as typeof fetch,
    })
    await engine.run()
    expect(server.rows.size).toBe(1) // exercised: the push reached the server
    expect((await a.db.entries.toArray())[0]!.serverVersion).toBeNull() // but the late answer wrote nothing here
    expect(await a.db.outbox.count()).toBe(1)
  })

  // C: the device is claimed by the first account that passes the check, even if its first pull fails.
  it('claims the device before the first pull, so a later sign-in as someone else is refused', async () => {
    const a = device(server)
    await captureEntry('written as A', a.db)
    server.script.push(() => FakeServer.json({ id: 'user-a' })) // /me
    // push goes through the real handler (script is empty again), then the pull fails
    const real = server.fetch
    const failingPull = new SyncEngine({
      db: a.db, apiUrl: 'https://api.test', token: () => 'tok-a', online: () => true, yieldNow: async () => {},
      fetch: (async (...args: Parameters<typeof fetch>) => (String(args[0]).includes('/sync/pull') ? FakeServer.json({ error: 'boom' }, 500) : real(...args))) as typeof fetch,
    })
    await failingPull.run()
    expect(failingPull.state.phase).toBe('waiting')
    expect((await a.db.syncMeta.toArray()).map((m) => m.userId)).toEqual(['user-a']) // claimed
    // someone else signs in on this device and one more note is queued
    server.tokens.set('tok-b', 'user-b')
    await captureEntry('written after B signed in', a.db)
    const asB = new SyncEngine({ db: a.db, fetch: server.fetch as typeof fetch, apiUrl: 'https://api.test', token: () => 'tok-b', online: () => true, yieldNow: async () => {} })
    server.requests.length = 0
    await asB.run()
    expect(asB.state.phase).toBe('foreign-account')
    expect(server.count('/sync/push')).toBe(0)
  })
})

describe('no token', () => {
  it('does nothing and sends nothing', async () => {
    const a = device(server, null)
    await captureEntry('x', a.db)
    await a.engine.run()
    expect(server.requests).toHaveLength(0)
    expect(await a.db.outbox.count()).toBe(1)
  })
})
