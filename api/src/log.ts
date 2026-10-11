// POST /log — the app reports that something broke (S4, D-24). Deliberately poor in content: an error kind, the app
// route it happened on and the build id. No message (a message can quote a note), no user id, no IP. Unauthenticated,
// because a signed-out device breaks too; so it is rate limited per address, size-bounded, strictly validated, and the
// table is capped. Read it with `wrangler d1 execute planner --remote --command "SELECT ... FROM error_log"` (RUNBOOK).
import { Hono } from 'hono'
import { byIp } from './ratelimit'
import type { Env } from './index'

export const LOG_MAX_ROWS = 500
const BODY_MAX_BYTES = 1_000
const KIND = /^[a-z0-9][a-z0-9._:-]{0,39}$/
const ROUTE = /^\/[A-Za-z0-9._~/-]{0,79}$/
const BUILD = /^[A-Za-z0-9._+-]{1,40}$/

export const logApi = new Hono<{ Bindings: Env }>()

logApi.use('*', byIp('RL_PUSH_IP'))

logApi.post('/', async (c) => {
  const text = await c.req.text()
  if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) return c.json({ error: 'body too large' }, 413)
  let body: unknown
  try { body = JSON.parse(text) } catch { return c.json({ error: 'not JSON' }, 400) }
  const { kind, route, build } = (body ?? {}) as Record<string, unknown>
  if (typeof kind !== 'string' || !KIND.test(kind)) return c.json({ error: 'kind: not accepted' }, 400)
  if (typeof route !== 'string' || !ROUTE.test(route)) return c.json({ error: 'route: not accepted' }, 400)
  if (typeof build !== 'string' || !BUILD.test(build)) return c.json({ error: 'build: not accepted' }, 400)
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO error_log (at, kind, route, build) VALUES (?, ?, ?, ?)').bind(Date.now(), kind, route, build),
    c.env.DB.prepare('DELETE FROM error_log WHERE id <= (SELECT MAX(id) FROM error_log) - ?').bind(LOG_MAX_ROWS),
  ])
  return c.body(null, 204)
})
