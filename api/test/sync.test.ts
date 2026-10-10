// H1 §10 backend rows: push idempotency · isolation · stale-base edit keeps text · delete is not resurrected · cleaning,
// plus what step 4 adds around them (versions, pull, query, session renewal, the write race). Accounts are made through
// the production `createSession`; no provider is involved.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createSession } from '../src/auth'
import { pushMutations } from '../src/entries'
import app from '../src/index'

const API = 'https://api.test'
const DAY = 86_400_000

type Account = { id: string; token: string }

async function account(email: string): Promise<Account> {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const iso = (min = 0) => new Date(Date.UTC(2026, 9, 10, 8, min)).toISOString()

type Payload = {
  id: string; body: string; createdAt: string; occurredAt: string | null; categoryId: string | null
  tags: string[]; origin: string; updatedAt: string; deletedAt: string | null
}
const input = (over: Partial<Payload> & Record<string, unknown> = {}): Payload => ({
  id: uuid(), body: 'hello', createdAt: iso(), occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: iso(), deletedAt: null,
  ...over,
})
const upsert = (payload: Payload, baseVersion: number | null = null) => ({ entityId: payload.id, op: 'upsert', baseVersion, payload })
const del = (payload: Payload, baseVersion: number | null, at = iso(30)) => ({
  entityId: payload.id, op: 'delete', baseVersion, payload: { ...payload, deletedAt: at, updatedAt: at },
})

const call = (token: string | null, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }), env)
const push = (a: Account, mutations: unknown[]) =>
  call(a.token, '/sync/push', { method: 'POST', body: JSON.stringify({ mutations }), headers: { 'Content-Type': 'application/json' } })
const pushOk = async (a: Account, mutations: unknown[]) => {
  const res = await push(a, mutations)
  expect(res.status).toBe(200)
  return ((await res.json()) as { results: Record<string, unknown>[] }).results
}
const pull = async (a: Account, qs = '') => (await call(a.token, `/sync/pull${qs}`)).json() as Promise<{ changes: Record<string, unknown>[]; cursor: number; more: boolean }>

const rows = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).all<Record<string, unknown>>().then((r) => r.results)
const count = async (table: string) => ((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n)

describe('push idempotency', () => {
  // Known positive: the first push really writes, so "second push writes nothing" cannot pass vacuously.
  it('replaying a push creates no second row, no new version, no revision', async () => {
    const a = await account('a@example.com')
    const e = input()
    const first = await pushOk(a, [upsert(e)])
    expect(first).toEqual([{ entityId: e.id, status: 'applied', serverVersion: 1 }])
    expect(await count('entries')).toBe(1)

    const again = await pushOk(a, [upsert(e)])
    expect(again).toEqual([{ entityId: e.id, status: 'duplicate', serverVersion: 1 }])
    expect(await count('entries')).toBe(1)
    expect(await count('entry_revisions')).toBe(0)
    expect(await env.DB.prepare('SELECT version_seq FROM users WHERE id = ?').bind(a.id).first()).toEqual({ version_seq: 1 })
  })

  it('a replayed delete is a duplicate too', async () => {
    const a = await account('a@example.com')
    const e = input()
    await pushOk(a, [upsert(e)])
    const d = del(e, 1)
    expect((await pushOk(a, [d]))[0]).toMatchObject({ status: 'applied', serverVersion: 2 })
    expect((await pushOk(a, [d]))[0]).toMatchObject({ status: 'duplicate', serverVersion: 2 })
  })

  it('the original create replayed after a delete changes nothing (no bump, no undelete)', async () => {
    const a = await account('a@example.com')
    const e = input()
    await pushOk(a, [upsert(e)])
    await pushOk(a, [del(e, 1)])
    expect((await pushOk(a, [upsert(e)]))[0]).toMatchObject({ status: 'duplicate', serverVersion: 2 })
    expect(await rows('SELECT deleted_at FROM entries')).toEqual([{ deleted_at: iso(30) }])
  })
})

describe('versions', () => {
  it('applied mutations get distinct, increasing versions that match the account counter', async () => {
    const a = await account('a@example.com')
    const batch = [input(), input(), input()]
    const res = await pushOk(a, batch.map((e) => upsert(e)))
    expect(res.map((r) => r.serverVersion)).toEqual([1, 2, 3])
    expect(await env.DB.prepare('SELECT version_seq FROM users WHERE id = ?').bind(a.id).first()).toEqual({ version_seq: 3 })
  })

  it('results keep request order when some are rejected or duplicates', async () => {
    const a = await account('a@example.com')
    const known = input()
    await pushOk(a, [upsert(known)])
    const res = await pushOk(a, [upsert(input({ body: '' })), upsert(known), upsert(input())])
    expect(res.map((r) => r.status)).toEqual(['rejected', 'duplicate', 'applied'])
  })

  it('two mutations of one entity in one request: both are handled, in order', async () => {
    const a = await account('a@example.com')
    const e = input()
    const res = await pushOk(a, [upsert(e), upsert({ ...e, body: 'edited', updatedAt: iso(5) })])
    expect(res.map((r) => r.status)).toEqual(['applied', 'applied'])
    expect(res.map((r) => r.serverVersion)).toEqual([1, 2])
    expect((await rows('SELECT body FROM entries'))[0].body).toBe('edited')
  })
})

describe('isolation', () => {
  // Negative control (H1 §10): this is the assertion that fails if a query forgets `user_id`.
  it("account B cannot read account A's entry by id (404), pull or query", async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const e = input({ body: 'private to A' })
    await pushOk(a, [upsert(e)])

    expect((await call(a.token, `/entries/${e.id}`)).status).toBe(200) // known positive: A sees it
    expect((await call(b.token, `/entries/${e.id}`)).status).toBe(404)
    expect((await pull(b)).changes).toEqual([])
    expect(await (await call(b.token, '/entries')).json()).toEqual({ entries: [], next: null })
    expect(await (await call(b.token, '/entries?q=private')).json()).toEqual({ entries: [], next: null })
  })

  it('the same id pushed by B makes B its own row and leaves A\'s alone', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const e = input({ body: 'A text' })
    await pushOk(a, [upsert(e)])
    expect((await pushOk(b, [upsert({ ...e, body: 'B text' })]))[0]).toMatchObject({ status: 'applied', serverVersion: 1 })
    expect((await (await call(a.token, `/entries/${e.id}`)).json() as { body: string }).body).toBe('A text')
    expect((await (await call(b.token, `/entries/${e.id}`)).json() as { body: string }).body).toBe('B text')
    expect(await count('entries')).toBe(2)
  })

  it('a user_id in the payload is ignored: the row belongs to the session\'s account', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const e = { ...input(), user_id: b.id, userId: b.id }
    await pushOk(a, [{ entityId: e.id, op: 'upsert', baseVersion: null, payload: e }])
    expect(await rows('SELECT user_id FROM entries')).toEqual([{ user_id: a.id }])
  })

  // A leak here is silent data loss: B's decision would be made against A's row and B's entry never saved.
  it('B pushing the very same content as A is B\'s own new entry, not a duplicate and not a conflict', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const e = input({ body: 'same words' })
    await pushOk(a, [upsert(e)])
    expect(await pushOk(b, [upsert(e)])).toEqual([{ entityId: e.id, status: 'applied', serverVersion: 1 }])
    expect(await rows('SELECT user_id FROM entries ORDER BY user_id')).toHaveLength(2)
    expect(await count('entry_revisions')).toBe(0)
  })

  it("B's revisions and version counter are separate from A's", async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    await pushOk(a, [upsert(input()), upsert(input())])
    expect((await pushOk(b, [upsert(input())]))[0]).toMatchObject({ serverVersion: 1 })
  })
})

describe('stale-base edit keeps text', () => {
  async function twoDevices() {
    const a = await account('a@example.com')
    const e = input({ body: 'original' })
    await pushOk(a, [upsert(e)]) // v1
    await pushOk(a, [upsert({ ...e, body: 'device 2 edit', updatedAt: iso(2) }, 1)]) // v2, base fresh
    return { a, e }
  }

  // Negative control: an edit on the *current* base keeps no revision, so "a revision exists" is not vacuous.
  it('an edit on the current base applies without a conflict or a revision', async () => {
    const { a, e } = await twoDevices()
    const res = await pushOk(a, [upsert({ ...e, body: 'on time', updatedAt: iso(3) }, 2)])
    expect(res[0]).toEqual({ entityId: e.id, status: 'applied', serverVersion: 3 })
    expect(await count('entry_revisions')).toBe(0)
  })

  it('a stale edit is applied, flagged, and the text it replaced is kept', async () => {
    const { a, e } = await twoDevices()
    const res = await pushOk(a, [upsert({ ...e, body: 'device 1 edit', updatedAt: iso(4) }, 1)]) // made against v1
    expect(res[0]).toEqual({ entityId: e.id, status: 'applied', serverVersion: 3, conflict: true })
    expect((await rows('SELECT body, server_version FROM entries'))[0]).toEqual({ body: 'device 1 edit', server_version: 3 })
    expect(await rows('SELECT server_version, body FROM entry_revisions')).toEqual([{ server_version: 2, body: 'device 2 edit' }])
  })

  it('an edit pushed with no base against an existing row is treated as stale (lost-ack case), nothing lost', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'first' })
    await pushOk(a, [upsert(e)])
    const res = await pushOk(a, [upsert({ ...e, body: 'second', updatedAt: iso(1) }, null)])
    expect(res[0]).toMatchObject({ status: 'applied', conflict: true })
    expect(await rows('SELECT body FROM entry_revisions')).toEqual([{ body: 'first' }])
  })
})

describe('revisions', () => {
  // Without `user_id` in the copy, B's stale edit would file A's row under A's history (same id, same version).
  it("each account's revisions hold only its own text", async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const e = input({ body: 'A original' })
    await pushOk(a, [upsert(e)])
    await pushOk(b, [upsert({ ...e, body: 'B original' })])
    await pushOk(a, [upsert({ ...e, body: 'A second', updatedAt: iso(2) }, 1)])
    await pushOk(b, [upsert({ ...e, body: 'B second', updatedAt: iso(2) }, null)]) // stale (no base) -> B's revision
    await pushOk(a, [upsert({ ...e, body: 'A third', updatedAt: iso(3) }, null)]) // stale -> A's revision
    expect(await rows('SELECT body FROM entry_revisions WHERE user_id = ?', a.id)).toEqual([{ body: 'A second' }])
    expect(await rows('SELECT body FROM entry_revisions WHERE user_id = ?', b.id)).toEqual([{ body: 'B original' }])
  })

  // A stale edit carries the whole entry, so it also replaces tags, category and dates: those must not vanish.
  it("keeps the replaced entry's tags, category and dates, not just its text", async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'v1' })
    await pushOk(a, [upsert(e)])
    await pushOk(a, [upsert({ ...e, body: 'v2', tags: ['trip'], categoryId: 'cat-travel', occurredAt: '2026-10-01', updatedAt: iso(2) }, 1)])
    await pushOk(a, [upsert({ ...e, body: 'v1 edited offline', updatedAt: iso(3) }, 1)]) // stale: still has no tags or category
    const rev = (await rows('SELECT body, meta FROM entry_revisions'))[0]
    expect(rev.body).toBe('v2')
    expect(JSON.parse(rev.meta as string)).toEqual({
      createdAt: iso(), occurredAt: '2026-10-01', categoryId: 'cat-travel', tags: ['trip'], updatedAt: iso(2),
    })
    expect((await rows('SELECT category_id, tags FROM entries'))[0]).toEqual({ category_id: null, tags: '[]' })
  })
})

describe('delete is not resurrected', () => {
  it('a delete reaches pull as a tombstone', async () => {
    const a = await account('a@example.com')
    const e = input()
    await pushOk(a, [upsert(e)])
    await pushOk(a, [del(e, 1)])
    const { changes } = await pull(a, '?since=1')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ id: e.id, deletedAt: iso(30), serverVersion: 2 })
  })

  // Negative control: before the delete the same edit is an ordinary edit, so "stays deleted" is the delete's doing.
  it('an old device editing after the delete does not bring the entry back; its text is applied and the earlier text kept', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'before' })
    await pushOk(a, [upsert(e)]) // v1
    await pushOk(a, [del(e, 1)]) // v2 — the old device has not pulled this
    const res = await pushOk(a, [upsert({ ...e, body: 'edit from the old device', updatedAt: iso(40) }, 1)])
    expect(res[0]).toMatchObject({ status: 'applied', serverVersion: 3, conflict: true })

    const row = (await rows('SELECT body, deleted_at, server_version FROM entries'))[0]
    expect(row).toEqual({ body: 'edit from the old device', deleted_at: iso(30), server_version: 3 })
    expect(await rows('SELECT body, deleted_at FROM entry_revisions')).toEqual([{ body: 'before', deleted_at: iso(30) }])
    expect((await pull(a, '?since=2')).changes[0]).toMatchObject({ deletedAt: iso(30), serverVersion: 3 })
  })

  it('a delete with a stale base still applies and keeps the replaced text', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'v1' })
    await pushOk(a, [upsert(e)])
    await pushOk(a, [upsert({ ...e, body: 'v2', updatedAt: iso(2) }, 1)])
    const res = await pushOk(a, [del(e, 1)])
    expect(res[0]).toMatchObject({ status: 'applied', conflict: true })
    expect(await rows('SELECT body FROM entry_revisions')).toEqual([{ body: 'v2' }])
  })

  it('a delete for an entry the server never saw is stored as a tombstone', async () => {
    const a = await account('a@example.com')
    const e = input()
    expect((await pushOk(a, [del(e, null)]))[0]).toMatchObject({ status: 'applied' })
    expect((await pull(a)).changes[0]).toMatchObject({ id: e.id, deletedAt: iso(30) })
  })
})

describe('cleaning on the server', () => {
  it('strips control characters and normalises before storing', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'café\r\nnote\u0000  ' })
    await pushOk(a, [upsert(e)])
    expect((await rows('SELECT body FROM entries'))[0].body).toBe('café\nnote')
  })

  it('refuses 20,001 characters and writes nothing', async () => {
    const a = await account('a@example.com')
    const ok = input({ body: 'x'.repeat(20_000) })
    const over = input({ body: 'x'.repeat(20_001) })
    const res = await pushOk(a, [upsert(ok), upsert(over)])
    expect(res.map((r) => r.status)).toEqual(['applied', 'rejected']) // 20,000 passes: the bound is on the right side
    expect(String(res[1].error)).toContain('body')
    expect(await count('entries')).toBe(1)
  })

  it('a rejection never quotes the owner text', async () => {
    const a = await account('a@example.com')
    const res = await pushOk(a, [upsert(input({ body: 'secret text', createdAt: 'yesterday' }))])
    expect(res[0].status).toBe('rejected')
    expect(JSON.stringify(res)).not.toContain('secret text')
  })

  it('refuses a mutation that does not name its own entity, or has a bad op or base', async () => {
    const a = await account('a@example.com')
    const e = input()
    const res = await pushOk(a, [
      { entityId: uuid(), op: 'upsert', baseVersion: null, payload: e },
      { entityId: e.id, op: 'upsert', baseVersion: 0, payload: e },
      { entityId: e.id, op: 'upsert', baseVersion: '1', payload: e },
      { entityId: e.id, op: 'patch', baseVersion: null, payload: e },
      { entityId: e.id, op: 'delete', baseVersion: null, payload: e }, // delete with no deletedAt
      'nonsense',
      null,
    ])
    expect(res.map((r) => r.status)).toEqual(Array(7).fill('rejected'))
    expect(await count('entries')).toBe(0)
  })

  it('an id in capitals is the same entity as its lower-case form', async () => {
    const a = await account('a@example.com')
    const e = input()
    await pushOk(a, [upsert(e)])
    const upper = { ...e, id: e.id.toUpperCase() }
    expect((await pushOk(a, [{ entityId: upper.id, op: 'upsert', baseVersion: 1, payload: upper }]))[0].status).toBe('duplicate')
  })
})

describe('request bounds', () => {
  it('rejects 101 mutations, a non-array, bad JSON, and an oversize body', async () => {
    const a = await account('a@example.com')
    expect((await push(a, Array(101).fill(upsert(input())))).status).toBe(400)
    expect((await push(a, Array(100).fill(null))).status).toBe(200) // 100 is allowed (all rejected, none crash)
    expect((await call(a.token, '/sync/push', { method: 'POST', body: '{"mutations":5}' })).status).toBe(400)
    expect((await call(a.token, '/sync/push', { method: 'POST', body: 'not json' })).status).toBe(400)
    expect((await call(a.token, '/sync/push', { method: 'POST', body: JSON.stringify({ mutations: [], pad: 'x'.repeat(1_000_001) }) })).status).toBe(413)
    expect(await count('entries')).toBe(0)
  })
})

describe('request size', () => {
  const big = 'é'.repeat(600_000) // 600,000 characters, 1,200,000 bytes
  it('measures bytes, not characters', async () => {
    const a = await account('a@example.com')
    expect((await call(a.token, '/sync/push', { method: 'POST', body: JSON.stringify({ mutations: [], pad: big }) })).status).toBe(413)
    // Known positive: the same character count in ASCII (600,000 bytes) is accepted.
    expect((await call(a.token, '/sync/push', { method: 'POST', body: JSON.stringify({ mutations: [], pad: 'e'.repeat(600_000) }) })).status).toBe(200)
  })

  it('refuses on a declared Content-Length before reading', async () => {
    const a = await account('a@example.com')
    const res = await call(a.token, '/sync/push', { method: 'POST', body: '{"mutations":[]}', headers: { 'Content-Length': '2000000' } })
    expect(res.status).toBe(413)
  })
})

describe('CORS preflight', () => {
  it('answers OPTIONS for the app origin without a token', async () => {
    const res = await call(null, '/sync/push', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })
})

describe('sync auth and session renewal', () => {
  it('every sync route needs a live session', async () => {
    const a = await account('a@example.com')
    const e = input()
    await pushOk(a, [upsert(e)])
    for (const [method, path] of [['POST', '/sync/push'], ['GET', '/sync/pull'], ['GET', '/entries'], ['GET', `/entries/${e.id}`]] as const) {
      expect((await call(null, path, { method })).status, `${method} ${path} without a token`).toBe(401)
      expect((await call('not-a-token', path, { method })).status, `${method} ${path} with a bad token`).toBe(401)
    }
  })

  it('a revoked account is refused at once', async () => {
    const a = await account('a@example.com')
    await env.DB.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').bind(Date.now(), a.id).run()
    expect((await call(a.token, '/sync/pull')).status).toBe(401)
  })

  const expiry = async () => (await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>())!.expires_at

  it('a successful sync renews a session that is more than a day old', async () => {
    const a = await account('a@example.com')
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 5 * DAY).run()
    expect((await call(a.token, '/sync/pull')).status).toBe(200)
    expect(await expiry()).toBeGreaterThan(Date.now() + 29 * DAY)
  })

  it('does not write on every sync: a fresh session is left alone', async () => {
    const a = await account('a@example.com')
    const before = await expiry()
    await call(a.token, '/sync/pull')
    expect(await expiry()).toBe(before)
  })

  // The push has committed by the time renewal runs; a renewal error must not make the client replay it.
  it('a renewal that throws does not fail a sync that succeeded', async () => {
    const a = await account('a@example.com')
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 5 * DAY).run()
    await env.DB.exec("CREATE TRIGGER no_renew BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'renewal blocked'); END")
    const e = input()
    expect(await pushOk(a, [upsert(e)])).toEqual([{ entityId: e.id, status: 'applied', serverVersion: 1 }])
    expect(await expiry()).toBeLessThan(Date.now() + 6 * DAY) // known positive: the trigger really blocked the renewal
    expect(await count('entries')).toBe(1)
  })

  it('a failed request does not renew', async () => {
    const a = await account('a@example.com')
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 5 * DAY).run()
    expect((await call(a.token, '/sync/pull?since=abc')).status).toBe(400)
    expect(await expiry()).toBeLessThan(Date.now() + 6 * DAY)
  })
})

describe('pull', () => {
  it('returns changes after the cursor, oldest first, and pages with `more`', async () => {
    const a = await account('a@example.com')
    await pushOk(a, [input(), input(), input(), input(), input()].map((e) => upsert(e)))
    const p1 = await pull(a, '?since=0&limit=2')
    expect(p1.changes.map((c) => c.serverVersion)).toEqual([1, 2])
    expect([p1.cursor, p1.more]).toEqual([2, true])
    const p2 = await pull(a, `?since=${p1.cursor}&limit=2`)
    expect(p2.changes.map((c) => c.serverVersion)).toEqual([3, 4])
    const p3 = await pull(a, `?since=${p2.cursor}&limit=2`)
    expect([p3.changes.map((c) => c.serverVersion), p3.cursor, p3.more]).toEqual([[5], 5, false])
    const end = await pull(a, '?since=5')
    expect([end.changes, end.cursor, end.more]).toEqual([[], 5, false])
  })

  it('an edit moves the entry to the end of the feed', async () => {
    const a = await account('a@example.com')
    const e = input()
    await pushOk(a, [upsert(e), upsert(input())])
    await pushOk(a, [upsert({ ...e, body: 'changed', updatedAt: iso(9) }, 1)])
    expect((await pull(a, '?since=2')).changes[0]).toMatchObject({ id: e.id, body: 'changed', serverVersion: 3 })
  })

  it('returns entries in the client shape', async () => {
    const a = await account('a@example.com')
    const e = input({ tags: ['b', 'a'], occurredAt: '2026-10-09', categoryId: 'cat-travel' })
    await pushOk(a, [upsert(e)])
    expect((await pull(a)).changes[0]).toEqual({ ...e, serverVersion: 1 })
  })

  it('refuses a malformed cursor or limit', async () => {
    const a = await account('a@example.com')
    for (const qs of ['?since=-1', '?since=1.5', '?since=abc', '?limit=0', '?limit=x']) {
      expect((await call(a.token, `/sync/pull${qs}`)).status, qs).toBe(400)
    }
  })

  it('caps the page at 500 however large a limit is asked for', async () => {
    const a = await account('a@example.com')
    for (let i = 0; i < 6; i++) await pushOk(a, Array.from({ length: i < 5 ? 100 : 1 }, () => upsert(input())))
    const page = await pull(a, '?limit=100000')
    expect(page.changes).toHaveLength(500)
    expect([page.cursor, page.more]).toEqual([500, true])
  })
})

describe('GET /entries', () => {
  async function seed() {
    const a = await account('a@example.com')
    const e = (body: string, createdAt: string, extra: Record<string, unknown> = {}) => upsert(input({ body, createdAt, updatedAt: createdAt, ...extra }))
    await pushOk(a, [
      e('oct 8 late', '2026-10-08T23:59:59.999Z'),
      e('oct 9 early', '2026-10-09T00:00:00.000Z'),
      e('oct 9 100% done', '2026-10-09T12:00:00.000Z'),
      e('oct 9 snake_case', '2026-10-09T13:00:00.000Z'),
      e('oct 10', '2026-10-10T00:00:00.000Z'),
      e('oct 11', '2026-10-11T00:00:00.000Z'),
    ])
    return a
  }
  const list = async (a: Account, qs = '') => (await (await call(a.token, `/entries${qs}`)).json()) as { entries: { body: string }[]; next: string | null }
  const bodies = (r: { entries: { body: string }[] }) => r.entries.map((x) => x.body)

  it('lists newest first', async () => {
    const a = await seed()
    expect(bodies(await list(a))[0]).toBe('oct 11')
  })

  it('a date range is inclusive of both days (UTC)', async () => {
    const a = await seed()
    expect(bodies(await list(a, '?from=2026-10-09&to=2026-10-10')).sort()).toEqual(['oct 10', 'oct 9 100% done', 'oct 9 early', 'oct 9 snake_case'])
  })

  it('LIKE text search is case-insensitive and treats % and _ literally', async () => {
    const a = await seed()
    expect(bodies(await list(a, '?q=OCT%2010'))).toEqual(['oct 10'])
    expect(bodies(await list(a, `?q=${encodeURIComponent('100%')}`))).toEqual(['oct 9 100% done'])
    expect(bodies(await list(a, `?q=${encodeURIComponent('snake_c')}`))).toEqual(['oct 9 snake_case'])
    // Known positive for the escape: an unescaped `_` or `%` would match far more than one row.
    expect(bodies(await list(a, `?q=${encodeURIComponent('oct _')}`))).toEqual([])
    expect(bodies(await list(a, `?q=${encodeURIComponent('%')}`))).toEqual(['oct 9 100% done'])
  })

  it('pages with a cursor and loses or repeats nothing', async () => {
    const a = await seed()
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const page = await list(a, `?limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      seen.push(...bodies(page))
      cursor = page.next
      if (!cursor) break
    }
    expect(seen).toHaveLength(6)
    expect(new Set(seen).size).toBe(6)
  })

  it('pages through entries that share a createdAt without skipping or repeating one', async () => {
    const a = await account('a@example.com')
    const same = '2026-10-09T09:00:00.000Z'
    await pushOk(a, ['a', 'b', 'c', 'd', 'e'].map((body) => upsert(input({ body, createdAt: same, updatedAt: same }))))
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const page = await list(a, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      seen.push(...bodies(page))
      cursor = page.next
      if (!cursor) break
    }
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('searches with a long text query (D1 refuses LIKE patterns over 50 bytes)', async () => {
    const a = await account('a@example.com')
    const long = 'a long remembered phrase with 100% certainty and snake_case in it, over fifty bytes'
    await pushOk(a, [upsert(input({ body: `before ${long} after` })), upsert(input({ body: 'unrelated' }))])
    expect(bodies(await list(a, `?q=${encodeURIComponent(long)}`))).toEqual([`before ${long} after`])
    expect(bodies(await list(a, `?q=${encodeURIComponent('x'.repeat(100))}`))).toEqual([])
  })

  it('hides deleted entries unless asked', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'gone' })
    await pushOk(a, [upsert(e), upsert(input({ body: 'kept' }))])
    await pushOk(a, [del(e, 1)])
    expect(bodies(await list(a))).toEqual(['kept'])
    expect(bodies(await list(a, '?deleted=1')).sort()).toEqual(['gone', 'kept'])
  })

  it('refuses malformed filters', async () => {
    const a = await account('a@example.com')
    for (const qs of ['?from=2026-02-30', '?to=yesterday', '?limit=0', '?q=', `?q=${'x'.repeat(101)}`, '?cursor=nobar']) {
      expect((await call(a.token, `/entries${qs}`)).status, qs).toBe(400)
    }
  })
})

describe('a write that races another device', () => {
  // The seam runs where another device's push could land: after our rows were read, before our batch is written.
  it('is decided again against the row that won, and the winner\'s text is kept', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'v1' })
    await pushOk(a, [upsert(e)])

    let raced = false
    const res = await pushMutations(env.DB, a.id, [upsert({ ...e, body: 'mine', updatedAt: iso(5) }, 1)], {
      afterRead: async () => {
        if (raced) return
        raced = true
        await pushOk(a, [upsert({ ...e, body: 'theirs', updatedAt: iso(6) }, 1)]) // the other device wins the race → v2
      },
    })
    // Mine's first attempt burns number 3 (its increment ran, its write was refused); the retry takes 4. Gaps are
    // harmless — pull only asks for versions above its cursor.
    expect(res[0]).toMatchObject({ status: 'applied', serverVersion: 4, conflict: true })
    expect((await rows('SELECT body, server_version FROM entries'))[0]).toEqual({ body: 'mine', server_version: 4 })
    expect(await rows('SELECT body, server_version FROM entry_revisions')).toEqual([{ body: 'theirs', server_version: 2 }])
  })

  // Negative control for the compare-and-swap: with no guard the loser overwrites the winner and keeps no copy.
  it('never overwrites the winner without a trace', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'v1' })
    await pushOk(a, [upsert(e)])
    let raced = false
    await pushMutations(env.DB, a.id, [upsert({ ...e, body: 'mine', updatedAt: iso(5) }, 1)], {
      afterRead: async () => {
        if (raced) return
        raced = true
        await pushOk(a, [upsert({ ...e, body: 'theirs', updatedAt: iso(6) }, 1)])
      },
    })
    const kept = (await rows('SELECT body FROM entry_revisions')).map((r) => r.body)
    expect(kept).toContain('theirs')
  })

  it('a create that races a create of the same id is retried, not duplicated', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'first' })
    let raced = false
    const res = await pushMutations(env.DB, a.id, [upsert({ ...e, body: 'second', updatedAt: iso(1) })], {
      afterRead: async () => {
        if (raced) return
        raced = true
        await pushOk(a, [upsert(e)])
      },
    })
    expect(res[0]).toMatchObject({ status: 'applied', serverVersion: 3, conflict: true }) // 2 was burned by the refused write
    expect(await count('entries')).toBe(1)
    expect(await rows('SELECT body FROM entry_revisions')).toEqual([{ body: 'first' }])
  })

  // The revision copy is part of the same guarded step: a write that did not happen leaves no copy behind.
  it('a racer that wrote exactly our content leaves a duplicate and no revision', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'v1' })
    await pushOk(a, [upsert(e)])
    await pushOk(a, [upsert({ ...e, body: 'v2', updatedAt: iso(2) }, 1)]) // row is v2; `mine` below is made against v1 → stale
    const mine = upsert({ ...e, body: 'same edit', updatedAt: iso(5) }, 1)
    let raced = false
    const res = await pushMutations(env.DB, a.id, [mine], {
      afterRead: async () => {
        if (raced) return
        raced = true
        await pushOk(a, [{ ...mine, baseVersion: 2 }]) // another device sends the identical edit first → v3, no conflict
      },
    })
    expect(res[0]).toMatchObject({ status: 'duplicate', serverVersion: 3 })
    expect(await count('entry_revisions')).toBe(0)
  })

  it('answers `retry` rather than guessing when every round loses', async () => {
    const a = await account('a@example.com')
    const e = input({ body: 'v1' })
    await pushOk(a, [upsert(e)])
    let v = 1
    const res = await pushMutations(env.DB, a.id, [upsert({ ...e, body: 'mine', updatedAt: iso(5) }, 1)], {
      afterRead: async () => { // a different device wins every round
        await pushOk(a, [upsert({ ...e, body: `theirs ${v}`, updatedAt: iso(10 + v) }, v)])
        v += 1
      },
    })
    expect(res).toEqual([{ entityId: e.id, status: 'retry' }])
    expect((await rows('SELECT body FROM entries'))[0].body).not.toBe('mine')
  })
})
