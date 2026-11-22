// api/scripts/export-local.mjs (via export-core.mjs) must write exactly the file Settings → Export downloads: the real
// `GET /me/export` pages joined by the app's own code (src/auth/accountExport.ts), for the same account. If a column
// mapping drifts on either side, these comparisons fail.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { assertSelect, buildExport, exportFileName, NoAccountError, type Query } from '../scripts/export-core.mjs'
import { exportPages } from '../../src/auth/accountExport'
import { createSession } from '../src/auth'
import { pushMutations } from '../src/entries'
import { pushRecords } from '../src/records'
import app from '../src/index'

const API = 'https://api.test'

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const iso = (min = 0) => new Date(Date.UTC(2026, 9, 10, 8, min)).toISOString()
const entry = (over: Record<string, unknown> = {}) => ({
  id: uuid(), body: 'hello', createdAt: iso(), occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: iso(), deletedAt: null, ...over,
})
const upsert = (p: ReturnType<typeof entry>, baseVersion: number | null = null) => ({ entityId: p.id, op: 'upsert', baseVersion, payload: p })
const question = (over: Record<string, unknown> = {}): Record<string, unknown> & { id: string } => ({
  id: `q-${++n}`, entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: iso(), answeredAt: null, runId: 'run-1', deletedAt: null, ...over,
})
const recUpsert = (p: ReturnType<typeof question>, baseVersion: number | null = null) => ({ recordKind: 'question', entityId: p.id, op: 'upsert', baseVersion, payload: p })

/** An account with entries (one deleted, one with a stale-edit revision, one with tags and a quote), and records with a revision. */
async function populated(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, "O'Name", Date.now()).run()
  await env.DB.prepare('INSERT INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)').bind('github', `gh-${id}`, id).run()
  await env.DB.prepare('INSERT INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)').bind('google', `go-${id}`, id).run()
  const keep = entry({ body: `it's kept by ${email}`, tags: ['home', 'shop'], occurredAt: '2026-10-09' })
  const gone = entry({ body: `deleted by ${email}` })
  const edited = entry({ body: 'first text' })
  await pushMutations(env.DB, id, [upsert(keep), upsert(gone), upsert(edited)])
  await pushMutations(env.DB, id, [{ entityId: gone.id, op: 'delete', baseVersion: 2, payload: { ...gone, deletedAt: iso(5), updatedAt: iso(5) } }])
  await pushMutations(env.DB, id, [upsert({ ...edited, body: 'second text' }, null)]) // stale base: the first text goes to revisions
  const asked = question({ text: `Asked of ${email}?` })
  const [first] = await pushRecords(env.DB, id, [recUpsert(asked), recUpsert(question({ text: 'Another?' }))])
  await pushRecords(env.DB, id, [recUpsert({ ...asked, state: 'answered', answer: `Answer by ${email}`, answeredAt: iso(6) }, first!.serverVersion!)])
  await pushRecords(env.DB, id, [recUpsert({ ...asked, state: 'dismissed' }, first!.serverVersion!)]) // stale base: the answer goes to record_revisions
  await pushMutations(env.DB, id, [upsert(entry({ body: 'last' }))])
  return { id, email, token: await createSession(env.DB, id) }
}

const d1: Query = async (sql) => (await env.DB.prepare(sql).all<Record<string, unknown>>()).results

/** The app's export of the account, through the Worker's real route; `limit` makes the Worker page small. */
async function appExport(token: string, limit?: number) {
  let pages = 0
  const fetchImpl: typeof fetch = async (input, init) => {
    pages++
    const url = limit ? `${String(input)}&limit=${limit}` : String(input)
    return app.fetch(new Request(url, init), env)
  }
  return { out: await exportPages(token, fetchImpl, API), pages: () => pages }
}

const withoutTime = <T extends { exportedAt: number }>(x: T) => ({ ...x, exportedAt: 0 })

describe('export-local: the same file as Settings → Export', () => {
  it('equals the app export of the same account, plus version_seq', async () => {
    const a = await populated('a@example.com')
    await populated('b@example.com') // another account: none of it may appear
    const { out: expected } = await appExport(a.token)
    const got = await buildExport(d1, 'a@example.com')
    // Rows exercised: an empty comparison would pass vacuously.
    expect(expected.entries).toHaveLength(4)
    expect(expected.revisions.length).toBeGreaterThan(0)
    expect(expected.records).toHaveLength(2)
    expect(expected.recordRevisions.length).toBeGreaterThan(0)
    const { version_seq, ...rest } = got
    expect(withoutTime(rest)).toEqual(withoutTime(expected))
    expect(JSON.stringify(withoutTime(rest))).toBe(JSON.stringify(withoutTime(expected))) // key order too: the same text
    const head = await env.DB.prepare('SELECT version_seq FROM users WHERE id = ?').bind(a.id).first<{ version_seq: number }>()
    expect(version_seq).toBe(head!.version_seq)
    expect(Object.keys(got)).toEqual(['format', 'exportedAt', 'account', 'identities', 'entries', 'revisions', 'records', 'recordRevisions', 'version_seq'])
  })

  it('pages the way the app does: equal across several pages too', async () => {
    const a = await populated('a@example.com')
    const { out: expected, pages } = await appExport(a.token, 2)
    expect(pages()).toBeGreaterThan(2) // exercised: the app export really paged
    const { version_seq: _v, ...got } = await buildExport(d1, 'a@example.com', { limit: 2 })
    expect(JSON.stringify(withoutTime(got))).toBe(JSON.stringify(withoutTime(expected)))
  })

  // Negative control: the comparison can fail — another account's export is not this one's.
  it('differs from the export of another account', async () => {
    await populated('a@example.com')
    const b = await populated('b@example.com')
    const { out: other } = await appExport(b.token)
    const { version_seq: _v, ...got } = await buildExport(d1, 'a@example.com')
    expect(withoutTime(got)).not.toEqual(withoutTime(other))
  })

  it('an email with no account is an error, and nothing else is read', async () => {
    await populated('a@example.com')
    const seen: string[] = []
    await expect(buildExport(async (sql) => (seen.push(sql), d1(sql)), 'nobody@example.com')).rejects.toBeInstanceOf(NoAccountError)
    expect(seen).toHaveLength(1)
  })

  it('issues SELECT statements only', async () => {
    await populated('a@example.com')
    const seen: string[] = []
    await buildExport(async (sql) => (seen.push(sql), d1(sql)), 'a@example.com', { limit: 2 })
    expect(seen.length).toBeGreaterThan(4) // exercised
    for (const sql of seen) expect(sql).toMatch(/^SELECT /)
  })
})

describe('assertSelect', () => {
  it('accepts a SELECT, also one whose literal holds a write word', () => {
    expect(() => assertSelect("SELECT id FROM users WHERE email = 'update.delete@example.com'")).not.toThrow()
    expect(() => assertSelect("SELECT 'it''s'")).not.toThrow()
    expect(() => assertSelect('WITH x AS (SELECT 1) SELECT * FROM x;')).not.toThrow()
  })

  it('refuses writes, several statements and pragmas', () => {
    for (const sql of [
      "UPDATE users SET name = 'x'",
      "INSERT INTO users (id) VALUES ('x')",
      'DELETE FROM entries',
      'SELECT 1; DROP TABLE users',
      'WITH x AS (DELETE FROM entries RETURNING id) SELECT * FROM x',
      'PRAGMA table_info(users)',
      "SELECT 'unbalanced",
    ]) expect(() => assertSelect(sql), sql).toThrow(/refused/)
  })
})

describe('exportFileName', () => {
  it('names the file by the local calendar day', () => {
    expect(exportFileName(new Date(2026, 10, 3, 23, 59))).toBe('planner-export-2026-11-03.json')
  })
})
