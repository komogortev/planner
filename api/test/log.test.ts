// POST /log (S4, D-24): what it accepts, what it refuses, that it stays capped, and that it holds nothing about a person.
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { LOG_DAILY_CAP, LOG_MAX_ROWS } from '../src/log'
import app from '../src/index'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(new Request('https://api.test/log', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env)
const rows = async () => (await env.DB.prepare('SELECT * FROM error_log ORDER BY id').all<{ id: number; at: number; kind: string; route: string; build: string }>()).results
const ok = { kind: 'js-error', route: '/settings', build: 'ccca2cf' }

describe('POST /log', () => {
  // Known positive first: a good report really writes, so the refusals below cannot pass on a route that writes nothing.
  it('stores a valid report: kind, route, build and a time, and answers 204', async () => {
    const res = await post(ok)
    expect(res.status).toBe(204)
    const [r] = await rows()
    expect(r).toMatchObject(ok)
    expect(Math.abs(r!.at - Date.now())).toBeLessThan(10_000)
  })

  it('refuses a malformed or hostile field and writes nothing', async () => {
    expect((await post(ok)).status).toBe(204) // exercised: the table is writable
    const before = (await rows()).length
    const bad: unknown[] = [
      { ...ok, kind: '' }, { ...ok, kind: 'UPPER' }, { ...ok, kind: 'has space' }, { ...ok, kind: 'x'.repeat(41) }, { ...ok, kind: 7 },
      { ...ok, route: 'settings' }, { ...ok, route: '/a?b=c' }, { ...ok, route: '/<script>' }, { ...ok, route: '/' + 'a'.repeat(80) },
      { ...ok, build: '' }, { ...ok, build: 'a b' }, { ...ok, build: 'x'.repeat(41) },
      { kind: 'js-error', route: '/' }, null, [], 'not json {',
    ]
    for (const b of bad) expect((await post(b as never)).status, JSON.stringify(b)).toBe(400)
    expect((await rows()).length).toBe(before)
  })

  it('refuses a body over 1 KB', async () => {
    const res = await post({ ...ok, note: 'x'.repeat(2_000) })
    expect(res.status).toBe(413)
  })

  it('ignores extra fields: only kind, route and build are stored', async () => {
    await post({ ...ok, message: 'my private note text', userId: 'u1', email: 'a@b.c' })
    const [r] = await rows()
    expect(Object.keys(r!).sort()).toEqual(['at', 'build', 'id', 'kind', 'route'])
    expect(JSON.stringify(r)).not.toContain('private')
  })

  it('keeps only the newest 500 rows', async () => {
    const stmts = Array.from({ length: LOG_MAX_ROWS + 5 }, (_, i) =>
      env.DB.prepare('INSERT INTO error_log (at, kind, route, build) VALUES (?, ?, ?, ?)').bind(i, 'seed', '/', 'b'))
    await env.DB.batch(stmts)
    expect((await rows()).length).toBe(LOG_MAX_ROWS + 5) // exercised: over the cap before the route runs
    expect((await post({ ...ok, kind: 'newest' })).status).toBe(204)
    const after = await rows()
    expect(after.length).toBe(LOG_MAX_ROWS)
    expect(after[after.length - 1]!.kind).toBe('newest')
    expect(after[0]!.kind).toBe('seed') // the oldest were the ones dropped
  })

  it('needs no sign-in (a signed-out device breaks too)', async () => {
    expect((await post(ok, {})).status).toBe(204)
  })
})

// A5 (SLICE-ACCEPTANCE): /log has its own per-IP budget and one global daily cap. The local limiter counts in fixed
// wall-clock windows (see ratelimit.test.ts), so each test starts clear of a minute boundary.
describe('POST /log limits (A5)', () => {
  beforeEach(async () => {
    const left = 60_000 - (Date.now() % 60_000)
    if (left < 5_000) await new Promise((r) => setTimeout(r, left + 100))
  })
  let n = 0
  const freshIp = () => `198.51.100.${++n}`
  const count = async () => (await rows()).length
  const seed = (k: number, at: number) =>
    env.DB.batch(Array.from({ length: k }, () => env.DB.prepare('INSERT INTO error_log (at, kind, route, build) VALUES (?, ?, ?, ?)').bind(at, 'seed', '/', 'b')))

  it('allows 10 a minute from one address, then 429, and the refused report writes nothing', async () => {
    const ip = freshIp()
    for (let i = 0; i < 10; i++) expect((await post(ok, { 'CF-Connecting-IP': ip })).status).toBe(204)
    const before = await count()
    expect((await post(ok, { 'CF-Connecting-IP': ip })).status).toBe(429)
    expect(await count()).toBe(before)
    expect((await post(ok, { 'CF-Connecting-IP': freshIp() })).status).toBe(204) // negative control: another address
  })

  it('no longer shares the push budget: an address over its /log limit can still push', async () => {
    const ip = freshIp()
    // 60 calls: a shared budget (the push per-IP limit is 60/min) would be spent by them, and the push would get 429.
    for (let i = 0; i < 60; i++) await post(ok, { 'CF-Connecting-IP': ip })
    expect((await post(ok, { 'CF-Connecting-IP': ip })).status).toBe(429) // exercised: /log is over for this address
    const push = await app.fetch(new Request('https://api.test/sync/push', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: '{}' }), env)
    expect(push.status).toBe(401) // reached auth: the push limit did not count the /log calls
  })

  it('the daily cap is below the row cap (the CAP-th newest row must still exist to be read)', () => {
    expect(LOG_DAILY_CAP).toBeLessThan(LOG_MAX_ROWS)
  })

  it('refuses every caller once 200 reports arrived within 24 hours, and writes nothing', async () => {
    await seed(LOG_DAILY_CAP, Date.now() - 60_000)
    const before = await count()
    const res = await post(ok, { 'CF-Connecting-IP': freshIp() })
    expect(res.status).toBe(429)
    expect(await count()).toBe(before)
  })

  it('accepts again when the 200th newest report is older than a day, and one short of the cap', async () => {
    await seed(LOG_DAILY_CAP, Date.now() - 25 * 3_600_000) // known positive: a full but old table is not a spent day
    expect((await post(ok)).status).toBe(204)
    await env.DB.prepare('DELETE FROM error_log').run()
    await seed(LOG_DAILY_CAP - 2, Date.now()) // 198 today: this one is the 199th, the next the 200th
    expect((await post(ok)).status).toBe(204)
    expect((await post(ok)).status).toBe(204)
    expect((await post(ok)).status).toBe(429) // boundary: the 201st within the day
  })
})
