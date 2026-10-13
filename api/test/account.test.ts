// S2b — account data lifecycle (ARCHITECTURE A13; DECISION-TREE D-48..D-50). Every claim of the form "X did not happen"
// is paired with a check that the thing it protects *did* exist first (rows exercised, then rows gone).
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_TABLES, uncoveredTables } from '../src/account'
import { createSession } from '../src/auth'
import { pushMutations } from '../src/entries'
import { pushRecords } from '../src/records'
import app from '../src/index'

const API = 'https://api.test'

type Account = { id: string; email: string; token: string }

async function account(email: string): Promise<Account> {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, 'Name', Date.now()).run()
  await env.DB.prepare('INSERT INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)').bind('github', `gh-${id}`, id).run()
  await env.DB.prepare('INSERT INTO invites (email, created_at, expires_at, used_by, used_at) VALUES (?, ?, ?, ?, ?)')
    .bind(email, Date.now(), Date.now() + 1e9, id, Date.now()).run()
  return { id, email, token: await createSession(env.DB, id) }
}

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

const call = (token: string | null, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }), env)
const del = (a: Account, confirm: unknown) =>
  call(a.token, '/me', { method: 'DELETE', body: JSON.stringify({ confirm }), headers: { 'Content-Type': 'application/json' } })

const count = async (sql: string, ...args: unknown[]) => ((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n)
const COUNT_BY_ACCOUNT: Record<string, string> = {
  entry_revisions: 'SELECT COUNT(*) AS n FROM entry_revisions WHERE user_id = ?',
  entries: 'SELECT COUNT(*) AS n FROM entries WHERE user_id = ?',
  record_revisions: 'SELECT COUNT(*) AS n FROM record_revisions WHERE user_id = ?',
  records: 'SELECT COUNT(*) AS n FROM records WHERE user_id = ?',
  ai_calls: 'SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ?',
  models: 'SELECT COUNT(*) AS n FROM models WHERE user_id = ?',
  sessions: 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?',
  identities: 'SELECT COUNT(*) AS n FROM identities WHERE user_id = ?',
  invites: 'SELECT COUNT(*) AS n FROM invites WHERE used_by = ?',
  users: 'SELECT COUNT(*) AS n FROM users WHERE id = ?',
}

/** An account holding a row in every table of ACCOUNT_TABLES: two entries (one deleted), a stale-edit revision, and a record with its own. */
async function populated(email: string) {
  const a = await account(email)
  const keep = entry({ body: `kept by ${email}` })
  const gone = entry({ body: `deleted by ${email}` })
  const edited = entry({ body: 'first text' })
  await pushMutations(env.DB, a.id, [upsert(keep), upsert(gone), upsert(edited)])
  await pushMutations(env.DB, a.id, [{ entityId: gone.id, op: 'delete', baseVersion: 2, payload: { ...gone, deletedAt: iso(5), updatedAt: iso(5) } }])
  await pushMutations(env.DB, a.id, [upsert({ ...edited, body: 'second text' }, null)]) // stale base: the first text goes to revisions
  const asked = question({ text: `Asked of ${email}?` })
  const [first] = await pushRecords(env.DB, a.id, [recUpsert(asked)]) // versions are the account's one counter, shared with entries
  await pushRecords(env.DB, a.id, [recUpsert({ ...asked, state: 'answered', answer: `Answer by ${email}`, answeredAt: iso(6) }, first!.serverVersion!)])
  await pushRecords(env.DB, a.id, [recUpsert({ ...asked, state: 'dismissed' }, first!.serverVersion!)]) // stale base: the answer goes to record_revisions
  // H5: a registered model with a key (through the route, so the key is really sealed) and one finished call with its reply.
  const modelKey = `sk-test-${email}-secret`
  const put = await call(a.token, '/me/models/m1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Mine', format: 'openai-chat', baseUrl: 'https://llm.example.com/v1', model: 'm-1', maxTokens: 4000, key: modelKey }),
  })
  expect(put.status).toBe(200)
  await env.DB.prepare(
    `INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, prompt, status, reply, started_at, finished_at)
     VALUES (?, ?, 'm1', 'harness', 'run-1', 3, 120, NULL, 'ok', ?, ?, ?)`,
  ).bind(a.id, crypto.randomUUID(), `reply for ${email}`, Date.now() - 5000, Date.now()).run()
  return { a, keep, gone, edited, asked, modelKey }
}

describe('A13 — every table is covered', () => {
  it('the real schema has no table outside ACCOUNT_TABLES and ACCOUNT_EXEMPT', async () => {
    expect(await uncoveredTables(env.DB)).toEqual([])
  })

  // Known positive: the check can fail, both when the list drops a table and when a migration adds one.
  it('reports a table the list does not cover', async () => {
    expect(await uncoveredTables(env.DB, ACCOUNT_TABLES.filter((t) => t.table !== 'entries'))).toEqual(['entries'])
    await env.DB.exec('CREATE TABLE widgets (user_id TEXT, id TEXT)')
    expect(await uncoveredTables(env.DB)).toEqual(['widgets'])
  })

  it('every table in the list exists and is counted by this test', async () => {
    for (const t of ACCOUNT_TABLES) expect(COUNT_BY_ACCOUNT[t.table], t.table).toBeTruthy()
  })
})

describe('GET /me/export', () => {
  it('returns every entry (deleted ones too), the revision, the account and its providers', async () => {
    const { a, keep, gone, edited, asked } = await populated('a@example.com')
    const res = await call(a.token, '/me/export')
    expect(res.status).toBe(200)
    const out = (await res.json()) as {
      format: number; account: { id: string; email: string }; identities: { provider: string }[]
      entries: { id: string; body: string; deletedAt: string | null }[]; revisions: { id: string; body: string }[]; more: boolean
      records: { recordKind: string; id: string; state: string }[]; recordRevisions: { recordKind: string; id: string; data: { answer: string } }[]
    }
    expect(out.format).toBe(1)
    expect(out.account).toMatchObject({ id: a.id, email: 'a@example.com' })
    expect(out.identities).toEqual([{ provider: 'github' }])
    expect(out.entries.map((e) => e.id).sort()).toEqual([keep.id, gone.id, edited.id].sort())
    expect(out.entries.find((e) => e.id === gone.id)?.deletedAt).not.toBeNull()
    expect(out.entries.find((e) => e.id === edited.id)?.body).toBe('second text')
    expect(out.revisions.map((r) => r.body)).toContain('first text')
    expect(out.more).toBe(false)
    // Records ride the same export: an export that read only entries would leave the owner's answers out of their own copy.
    expect(out.records).toMatchObject([{ recordKind: 'question', id: asked.id, state: 'dismissed' }])
    expect(out.recordRevisions).toMatchObject([{ recordKind: 'question', id: asked.id, data: { answer: 'Answer by a@example.com' } }])
  })

  it('never carries session tokens or their hashes', async () => {
    const { a } = await populated('a@example.com')
    const hash = (await env.DB.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').bind(a.id).first<{ token_hash: string }>())!.token_hash
    expect(hash.length).toBeGreaterThan(10) // exercised: a hash exists to be leaked
    const text = await (await call(a.token, '/me/export')).text()
    expect(text).not.toContain(hash)
    expect(text).not.toContain(a.token)
    expect(text).not.toContain('token_hash')
  })

  it('carries models without their key and calls without their prompt', async () => {
    const { a, modelKey } = await populated('a@example.com')
    const stored = (await env.DB.prepare('SELECT key_ct FROM models WHERE user_id = ?').bind(a.id).first<{ key_ct: string | null }>())!.key_ct
    expect(stored).toBeTruthy() // exercised: a sealed key exists to be leaked
    const res = await call(a.token, '/me/export')
    const text = await res.clone().text()
    const out = (await res.json()) as { models: { id: string; hasKey: boolean; keyHint: string }[]; aiCalls: { reply: string; status: string }[] }
    expect(out.models).toMatchObject([{ id: 'm1', hasKey: true, keyHint: modelKey.slice(-4) }])
    expect(out.aiCalls).toMatchObject([{ status: 'ok', reply: 'reply for a@example.com' }])
    expect(text).not.toContain(modelKey)
    expect(text).not.toContain(stored!)
    expect(text).not.toContain('key_ct')
    expect(text).not.toContain('"prompt"')
  })

  it('contains nothing of another account (isolation)', async () => {
    const { a } = await populated('a@example.com')
    const { a: b } = await populated('b@example.com')
    expect(await count(COUNT_BY_ACCOUNT.entries, b.id)).toBe(3) // exercised: B really has rows
    const text = await (await call(a.token, '/me/export')).text()
    expect(text).not.toContain('b@example.com')
    expect(text).not.toContain(b.id)
  })

  it('pages: the pages together equal the whole, and only the first carries the account', async () => {
    const a = await account('a@example.com')
    const all = Array.from({ length: 5 }, (_, i) => entry({ body: `e${i}` }))
    await pushMutations(env.DB, a.id, all.map((e) => upsert(e)))
    const ids: string[] = []
    let since = 0
    let pages = 0
    for (;;) {
      const out = (await (await call(a.token, `/me/export?since=${since}&limit=2`)).json()) as {
        account?: unknown; entries: { id: string }[]; cursor: number; more: boolean
      }
      pages++
      expect(out.account !== undefined).toBe(since === 0)
      ids.push(...out.entries.map((e) => e.id))
      since = out.cursor
      if (!out.more) break
    }
    expect(pages).toBe(3)
    expect(ids.sort()).toEqual(all.map((e) => e.id).sort())
  })

  it('refuses a malformed cursor and an unauthenticated call', async () => {
    const a = await account('a@example.com')
    expect((await call(a.token, '/me/export?since=-1')).status).toBe(400)
    expect((await call(a.token, '/me/export?limit=0')).status).toBe(400)
    expect((await call(null, '/me/export')).status).toBe(401)
  })
})

describe('DELETE /me', () => {
  // Rows exercised first: every table has a row for A, so "zero afterwards" cannot pass vacuously.
  it('removes every row of the account, in every table, and none of another account’s', async () => {
    const { a } = await populated('a@example.com')
    const { a: b } = await populated('b@example.com')
    for (const t of ACCOUNT_TABLES) {
      expect(await count(COUNT_BY_ACCOUNT[t.table], a.id), `before: ${t.table} (a)`).toBeGreaterThan(0)
    }
    const before = Object.fromEntries(await Promise.all(ACCOUNT_TABLES.map(async (t) => [t.table, await count(COUNT_BY_ACCOUNT[t.table], b.id)])))

    const res = await del(a, 'A@Example.com ') // the email, case and spacing forgiven
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })

    for (const t of ACCOUNT_TABLES) {
      expect(await count(COUNT_BY_ACCOUNT[t.table], a.id), `after: ${t.table} (a)`).toBe(0)
      expect(await count(COUNT_BY_ACCOUNT[t.table], b.id), `after: ${t.table} (b)`).toBe(before[t.table])
    }
    expect(await count('SELECT COUNT(*) AS n FROM invites WHERE email = ?', 'a@example.com')).toBe(0)
  })

  it('does nothing without the right confirmation', async () => {
    const { a } = await populated('a@example.com')
    for (const confirm of [undefined, '', 'yes', 'b@example.com', 42, null]) {
      expect((await del(a, confirm)).status, String(confirm)).toBe(400)
    }
    const raw = await call(a.token, '/me', { method: 'DELETE', body: 'not json' })
    expect(raw.status).toBe(400)
    for (const t of ACCOUNT_TABLES) expect(await count(COUNT_BY_ACCOUNT[t.table], a.id), t.table).toBeGreaterThan(0)
    expect((await call(a.token, '/me')).status).toBe(200) // still signed in
  })

  it('needs a signed-in caller', async () => {
    expect((await call(null, '/me', { method: 'DELETE', body: JSON.stringify({ confirm: 'x' }) })).status).toBe(401)
  })

  // The "account deleted" signal (D-50): a deleted account's other devices hear why, anyone else's bad token gets no reason.
  it('tells the account’s other devices "account-deleted" on every authenticated route', async () => {
    const a = await account('a@example.com')
    const other = await createSession(env.DB, a.id) // a second device
    expect((await call(other, '/sync/pull')).status).toBe(200) // exercised: the token works before
    expect((await del(a, 'a@example.com')).status).toBe(200)

    for (const path of ['/sync/pull', '/entries', '/me', '/me/export']) {
      for (const token of [a.token, other]) {
        const res = await call(token, path)
        expect(res.status, path).toBe(401)
        expect(await res.json(), path).toEqual({ error: 'signed out', reason: 'account-deleted' })
      }
    }
    // negative controls: a token that never existed, and a missing header, get the plain answer
    const stranger = await call(`not-a-token-${crypto.randomUUID()}`, '/sync/pull')
    expect(stranger.status).toBe(401)
    expect(await stranger.json()).toEqual({ error: 'signed out' })
    expect(await (await call(null, '/sync/pull')).json()).toEqual({ error: 'signed out' })
  })

  it('a second delete with the same token is refused as deleted, not applied again', async () => {
    const { a } = await populated('a@example.com')
    expect((await del(a, a.email)).status).toBe(200)
    const again = await del(a, a.email)
    expect(again.status).toBe(401)
    expect(await again.json()).toEqual({ error: 'signed out', reason: 'account-deleted' })
  })

  it('keeps only token hashes of the deleted account, nothing that names a person, and purges old ones', async () => {
    const a = await account('a@example.com')
    await env.DB.prepare('INSERT INTO deleted_tokens (token_hash, deleted_at) VALUES (?, ?)').bind('stale-hash', Date.now() - 40 * 86_400_000).run()
    await del(a, a.email)
    const rows = (await env.DB.prepare('SELECT * FROM deleted_tokens').all<{ token_hash: string; deleted_at: number }>()).results
    expect(rows).toHaveLength(1) // the account's one session; the 40-day-old row is gone
    expect(Object.keys(rows[0]).sort()).toEqual(['deleted_at', 'token_hash'])
    expect(JSON.stringify(rows)).not.toContain(a.id)
    expect(JSON.stringify(rows)).not.toContain('a@example.com')
  })

  it('lets the same email be invited and sign up again afterwards (no leftover invite or user row)', async () => {
    const { a } = await populated('a@example.com')
    await del(a, a.email)
    await expect(
      env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), 'a@example.com', null, Date.now()).run(),
    ).resolves.toBeTruthy()
    await expect(
      env.DB.prepare('INSERT INTO invites (email, created_at, expires_at) VALUES (?, ?, ?)').bind('a@example.com', Date.now(), Date.now() + 1e9).run(),
    ).resolves.toBeTruthy()
  })
})
