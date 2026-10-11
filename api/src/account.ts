// Account data lifecycle (ARCHITECTURE A13, H1-ENTRIES S2b): export everything an account holds, delete all of it.
// `ACCOUNT_TABLES` is the one list both operations read; test/account.test.ts fails when a migration adds a table that
// is in neither this list nor ACCOUNT_EXEMPT, so a new per-account table cannot ship without export and delete cover.
import { Hono } from 'hono'
import { authenticate, type AuthedSession } from './auth'
import { PULL_MAX, pullChanges, revisionsFor } from './entries'
import type { Env } from './index'

/**
 * Children first, `users` last (foreign keys). `delete` uses the numbered parameter ?1 = the account id. `exported`
 * says where the table's content reaches the export (sessions never do: they hold only token hashes).
 */
export const ACCOUNT_TABLES: readonly { table: string; delete: string; exported: 'entries' | 'revisions' | 'account' | 'identities' | 'no' }[] = [
  { table: 'entry_revisions', delete: 'DELETE FROM entry_revisions WHERE user_id = ?1', exported: 'revisions' },
  { table: 'entries', delete: 'DELETE FROM entries WHERE user_id = ?1', exported: 'entries' },
  { table: 'sessions', delete: 'DELETE FROM sessions WHERE user_id = ?1', exported: 'no' },
  { table: 'identities', delete: 'DELETE FROM identities WHERE user_id = ?1', exported: 'identities' },
  // The invite is keyed by the person's email, so it goes with the account (re-inviting is a new row).
  { table: 'invites', delete: 'DELETE FROM invites WHERE used_by = ?1 OR email = (SELECT email FROM users WHERE id = ?1)', exported: 'no' },
  { table: 'users', delete: 'DELETE FROM users WHERE id = ?1', exported: 'account' },
]

/** Tables that hold nothing about an account, with the reason. Everything else must be in ACCOUNT_TABLES. */
export const ACCOUNT_EXEMPT: Record<string, string> = {
  d1_migrations: 'Wrangler migration bookkeeping',
  deleted_tokens: 'SHA-256 of bearer tokens of deleted accounts, no user id (0006)',
}

/** User tables in the database that neither list covers. Empty when A13 holds. */
export async function uncoveredTables(
  db: D1Database,
  covered: readonly { table: string }[] = ACCOUNT_TABLES,
  exempt: Record<string, string> = ACCOUNT_EXEMPT,
): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .all<{ name: string }>()
  const known = new Set([...covered.map((t) => t.table), ...Object.keys(exempt)])
  return results.map((r) => r.name).filter((n) => !known.has(n))
}

export const EXPORT_FORMAT = 1

/**
 * One page of an account export. The client asks `since=0` first and follows `cursor` while `more`; the first page also
 * carries the account itself. Deleted entries are included — the export is everything the server holds for the person.
 */
export async function exportPage(db: D1Database, s: AuthedSession, since: number, limit: number) {
  const page = await pullChanges(db, s.id, since, limit)
  const revisions = await revisionsFor(db, s.id, page.changes.map((e) => e.id))
  const first = since === 0
  const account = first
    ? await db.prepare('SELECT id, email, name, created_at AS createdAt FROM users WHERE id = ?').bind(s.id).first()
    : undefined
  const identities = first
    ? (await db.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider').bind(s.id).all<{ provider: string }>()).results
    : undefined
  return { format: EXPORT_FORMAT, exportedAt: Date.now(), ...(first ? { account, identities } : {}), entries: page.changes, revisions, cursor: page.cursor, more: page.more }
}

/** Deletes every row of the account in one batch, after remembering its session tokens so its devices can be told. */
export async function deleteAccount(db: D1Database, userId: string): Promise<void> {
  const now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM deleted_tokens WHERE deleted_at < ?').bind(now - 31 * 86_400_000),
    db.prepare('INSERT OR IGNORE INTO deleted_tokens (token_hash, deleted_at) SELECT token_hash, ? FROM sessions WHERE user_id = ?').bind(now, userId),
    ...ACCOUNT_TABLES.map((t) => db.prepare(t.delete).bind(userId)),
  ])
}

async function sha256b64(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The 401 body: `reason` is set when the bearer token belonged to a deleted account. */
export async function signedOutBody(db: D1Database, authorization: string | undefined): Promise<{ error: string; reason?: 'account-deleted' }> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  if (token) {
    const hit = await db.prepare('SELECT 1 AS hit FROM deleted_tokens WHERE token_hash = ?').bind(await sha256b64(token)).first()
    if (hit) return { error: 'signed out', reason: 'account-deleted' }
  }
  return { error: 'signed out' }
}

type Vars = { session: AuthedSession }
export const meApi = new Hono<{ Bindings: Env; Variables: Vars }>()

meApi.use('*', async (c, next) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
})

// GET /me/export?since=<serverVersion>&limit=500
meApi.get('/export', async (c) => {
  const since = c.req.query('since') ?? '0'
  const limitQ = c.req.query('limit')
  if (!/^\d{1,15}$/.test(since)) return c.json({ error: 'since: not a version' }, 400)
  if (limitQ !== undefined && !/^\d{1,6}$/.test(limitQ)) return c.json({ error: 'limit: not a positive number' }, 400)
  const limit = limitQ === undefined ? PULL_MAX : Number(limitQ)
  if (limit < 1) return c.json({ error: 'limit: not a positive number' }, 400)
  return c.json(await exportPage(c.env.DB, c.get('session'), Number(since), Math.min(limit, PULL_MAX)))
})

// DELETE /me  { "confirm": "<the account's email>" } — hard delete, no undo. The export is the client's job, before this.
meApi.delete('/', async (c) => {
  const s = c.get('session')
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'not JSON' }, 400) }
  const confirm = (body as { confirm?: unknown } | null)?.confirm
  if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== s.email.toLowerCase()) {
    return c.json({ error: 'confirm: must be the email of the account' }, 400)
  }
  await deleteAccount(c.env.DB, s.id)
  return c.json({ deleted: true })
})
