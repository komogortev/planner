// /sync/push, /sync/pull, /entries (H1-ENTRIES.md §6, §9). Thin: auth, bounds, parsing; the rules live in entries.ts.
import { Hono } from 'hono'
import { authenticate, renewSession, type AuthedSession } from './auth'
import { overLimit, tooMany, byIp } from './ratelimit'
import { getEntry, pullChanges, pushMutations, queryEntries, PULL_MAX, PUSH_MAX_BYTES, PUSH_MAX_MUTATIONS } from './entries'
import type { Env } from './index'
import { isIsoDate } from '../../src/domain/clean'

type Vars = { session: AuthedSession }
export const sync = new Hono<{ Bindings: Env; Variables: Vars }>()
export const entriesApi = new Hono<{ Bindings: Env; Variables: Vars }>()

// Before authentication: a flood from one address costs no D1 read.
sync.use('/push', byIp('RL_PUSH_IP'))

for (const r of [sync, entriesApi]) {
  r.use('*', async (c, next) => {
    const s = await authenticate(c.env.DB, c.req.header('Authorization'))
    if (!s) return c.json({ error: 'signed out' }, 401)
    c.set('session', s)
    await next()
    // A request that did its job keeps the session alive (§8); a failed one does not. The work has committed by now, so
    // a failed renewal must not turn it into a 500 (the client would replay a push that applied): the next request renews.
    if (c.res.status < 400) {
      try { await renewSession(c.env.DB, s) } catch (err) { console.error('session renewal failed', err instanceof Error ? err.message : err) }
    }
  })
}

/** A non-negative integer from a query string, or null when it is absent or malformed. */
function int(v: string | undefined, fallback: number): number | null {
  if (v === undefined) return fallback
  return /^\d{1,15}$/.test(v) ? Number(v) : null
}

sync.post('/push', async (c) => {
  if (await overLimit(c.env, 'RL_PUSH_USER', c.get('session').id)) return tooMany(c)
  const declared = Number(c.req.header('Content-Length') ?? 0)
  if (declared > PUSH_MAX_BYTES) return c.json({ error: `body over ${PUSH_MAX_BYTES} bytes` }, 413)
  const text = await c.req.text()
  // Bytes, not UTF-16 units: a chunked request has no Content-Length, and 1M units can be 3 MB of UTF-8.
  if (new TextEncoder().encode(text).length > PUSH_MAX_BYTES) return c.json({ error: `body over ${PUSH_MAX_BYTES} bytes` }, 413)
  let body: unknown
  try { body = JSON.parse(text) } catch { return c.json({ error: 'not JSON' }, 400) }
  const mutations = (body as { mutations?: unknown } | null)?.mutations
  if (!Array.isArray(mutations)) return c.json({ error: 'mutations: not an array' }, 400)
  if (mutations.length > PUSH_MAX_MUTATIONS) return c.json({ error: `mutations: over ${PUSH_MAX_MUTATIONS}` }, 400)
  return c.json({ results: await pushMutations(c.env.DB, c.get('session').id, mutations) })
})

sync.get('/pull', async (c) => {
  const since = int(c.req.query('since'), 0)
  const limit = int(c.req.query('limit'), PULL_MAX)
  if (since === null) return c.json({ error: 'since: not a version' }, 400)
  if (limit === null || limit < 1) return c.json({ error: 'limit: not a positive number' }, 400)
  return c.json(await pullChanges(c.env.DB, c.get('session').id, since, Math.min(limit, PULL_MAX)))
})

// GET /entries?from=YYYY-MM-DD&to=YYYY-MM-DD&q=text&deleted=1&limit=50&cursor=… — newest first (UTC days on createdAt).
entriesApi.get('/', async (c) => {
  const { from, to, q, cursor, deleted } = c.req.query()
  const limit = int(c.req.query('limit'), 50)
  if (limit === null || limit < 1) return c.json({ error: 'limit: not a positive number' }, 400)
  if (from !== undefined && !isIsoDate(from)) return c.json({ error: 'from: not YYYY-MM-DD' }, 400)
  if (to !== undefined && !isIsoDate(to)) return c.json({ error: 'to: not YYYY-MM-DD' }, 400)
  if (q !== undefined && (q.length === 0 || q.length > 100)) return c.json({ error: 'q: 1–100 characters' }, 400)
  let after: { createdAt: string; id: string } | undefined
  if (cursor !== undefined) {
    const [createdAt, id] = cursor.split('|')
    if (!createdAt || !id) return c.json({ error: 'cursor: malformed' }, 400)
    after = { createdAt, id }
  }
  const page = await queryEntries(c.env.DB, c.get('session').id, {
    from, to, q, includeDeleted: deleted === '1', limit: Math.min(limit, 200), cursor: after,
  })
  return c.json({ entries: page.entries, next: page.next ? `${page.next.createdAt}|${page.next.id}` : null })
})

entriesApi.get('/:id', async (c) => {
  const entry = await getEntry(c.env.DB, c.get('session').id, c.req.param('id'))
  return entry ? c.json(entry) : c.json({ error: 'not found' }, 404)
})
