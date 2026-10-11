// POST /log (S4, D-24): what it accepts, what it refuses, that it stays capped, and that it holds nothing about a person.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { LOG_MAX_ROWS } from '../src/log'
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
