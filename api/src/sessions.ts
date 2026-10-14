// /me/sessions — a user's own sign-ins (D-22; D-90: before any invitee can register a model, since a stored key raises
// what a stolen session is worth). Tenant isolation as everywhere (A11): the user id comes from the session and every
// query binds it. A session is named by the first 16 characters of its token hash: enough to tell one from another,
// never the bearer token and never the whole stored hash.
import { Hono } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import type { Env } from './index'

export const SESSION_ID_LENGTH = 16
const SESSION_ID = /^[A-Za-z0-9_-]{16}$/

type Row = { token_hash: string; device: string | null; created_at: number; last_seen_at: number | null }
type Vars = { session: AuthedSession }
export const sessionsApi = new Hono<{ Bindings: Env; Variables: Vars }>()

sessionsApi.use('*', async (c, next) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
})

// GET /me/sessions — the live sessions, this one first, then the most recently seen.
sessionsApi.get('/', async (c) => {
  const s = c.get('session')
  const { results } = await c.env.DB.prepare(
    'SELECT token_hash, device, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > ?',
  ).bind(s.id, Date.now()).all<Row>()
  const sessions = results
    .map((r) => ({ id: r.token_hash.slice(0, SESSION_ID_LENGTH), device: r.device, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? r.created_at, current: r.token_hash === s.tokenHash }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt)
  return c.json({ sessions })
})

// DELETE /me/sessions/:id — signs out one other device. This device signs out with POST /auth/logout, which also tells
// the app to forget its token; refusing it here keeps "the list" from signing the caller out by surprise.
sessionsApi.delete('/:id', async (c) => {
  const s = c.get('session')
  const id = c.req.param('id')
  if (!SESSION_ID.test(id)) return c.json({ error: 'bad id' }, 400)
  if (s.tokenHash.startsWith(id)) return c.json({ error: 'this device: use Sign out' }, 409)
  const r = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, ?) = ?').bind(s.id, SESSION_ID_LENGTH, id).run()
  return r.meta.changes ? c.body(null, 204) : c.json({ error: 'not found' }, 404)
})

// POST /me/sessions/others — signs out every device but this one. Idempotent; says how many went.
sessionsApi.post('/others', async (c) => {
  const s = c.get('session')
  const r = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(s.id, s.tokenHash).run()
  return c.json({ signedOut: r.meta.changes })
})
