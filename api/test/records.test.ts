// HW-HARNESS S2, Worker side: record push idempotency · isolation per account · one cursor over entries and records ·
// stale edit keeps the replaced content · delete is not resurrected · the entry path is untouched. Synthetic data only.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createSession } from '../src/auth'
import { pushRecords } from '../src/records'
import app from '../src/index'

const API = 'https://api.test'
type Account = { id: string; token: string }

async function account(email: string): Promise<Account> {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const iso = (min = 0) => new Date(Date.UTC(2026, 9, 10, 8, min)).toISOString()

const entry = (over: Record<string, unknown> = {}) => ({
  id: uuid(), body: 'hello', createdAt: iso(), occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: iso(), deletedAt: null, ...over,
})
const question = (over: Record<string, unknown> = {}) => ({
  id: `q-${++n}`, entryId: 'n1', text: 'Which shop?', state: 'open', answer: null, createdAt: iso(), answeredAt: null, runId: 'run-1', deletedAt: null, ...over,
})
const entryState = (id: string, over: Record<string, unknown> = {}) => ({ id, state: 'done', followUpOn: null, by: 'owner', updatedAt: iso(), deletedAt: null, ...over })

type Payload = Record<string, unknown> & { id: string }
const rec = (recordKind: string, payload: Payload, baseVersion: number | null = null) => ({ recordKind, entityId: payload.id, op: 'upsert', baseVersion, payload })
const ent = (payload: Payload, baseVersion: number | null = null) => ({ entityId: payload.id, op: 'upsert', baseVersion, payload })
const delRec = (recordKind: string, payload: Payload, baseVersion: number | null, at = iso(30)) => ({
  recordKind, entityId: payload.id, op: 'delete', baseVersion, payload: { ...payload, deletedAt: at },
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
type Page = { changes: Record<string, unknown>[]; records?: Record<string, unknown>[]; cursor: number; more: boolean; head: number }
const pull = async (a: Account, qs = '') => (await call(a.token, `/sync/pull${qs}`)).json() as Promise<Page>

const rows = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).all<Record<string, unknown>>().then((r) => r.results)
const count = async (table: string) => ((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n)

describe('record push idempotency', () => {
  // Known positive: the first push really writes, so "second push writes nothing" cannot pass vacuously.
  it('replaying a push creates no second row, no new version, no revision', async () => {
    const a = await account('a@example.com')
    const q = question()
    expect(await pushOk(a, [rec('question', q)])).toEqual([{ entityId: q.id, status: 'applied', serverVersion: 1 }])
    expect(await count('records')).toBe(1)

    expect(await pushOk(a, [rec('question', q)])).toEqual([{ entityId: q.id, status: 'duplicate', serverVersion: 1 }])
    expect(await count('records')).toBe(1)
    expect(await count('record_revisions')).toBe(0)
    expect(await env.DB.prepare('SELECT version_seq FROM users WHERE id = ?').bind(a.id).first()).toEqual({ version_seq: 1 })
  })

  it('a replay with the keys in another order and a different casing of the id is still a duplicate (fixed-order storage)', async () => {
    const a = await account('a@example.com')
    const q = question({ id: 'q-case' })
    await pushOk(a, [rec('question', q)])
    const shuffled = Object.fromEntries(Object.entries(q).reverse()) as Payload
    const res = await pushOk(a, [{ recordKind: 'question', entityId: 'Q-CASE', op: 'upsert', baseVersion: null, payload: { ...shuffled, id: 'Q-CASE' } }])
    expect(res[0]).toMatchObject({ status: 'duplicate', serverVersion: 1 })
  })

  it('a replayed delete is a duplicate; the original create replayed after it changes nothing', async () => {
    const a = await account('a@example.com')
    const q = question()
    await pushOk(a, [rec('question', q)])
    expect((await pushOk(a, [delRec('question', q, 1)]))[0]).toMatchObject({ status: 'applied', serverVersion: 2 })
    expect((await pushOk(a, [delRec('question', q, 1)]))[0]).toMatchObject({ status: 'duplicate', serverVersion: 2 })
    expect((await pushOk(a, [rec('question', q)]))[0]).toMatchObject({ status: 'duplicate', serverVersion: 2 })
    expect(await rows('SELECT deleted_at FROM records')).toEqual([{ deleted_at: iso(30) }])
  })
})

describe('isolation', () => {
  it('one account never sees another’s records, and the same kind+id in two accounts are two rows', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const q = question({ id: 'shared-id', text: 'A private question?' })
    await pushOk(a, [rec('question', q)])
    expect((await pull(b)).records).toBeUndefined()
    expect((await pushOk(b, [rec('question', { ...q, text: 'B own question?' })]))[0]).toMatchObject({ status: 'applied', serverVersion: 1 })
    expect(await count('records')).toBe(2)
    expect((await pull(a)).records).toMatchObject([{ id: 'shared-id', text: 'A private question?' }])
    expect((await pull(b)).records).toMatchObject([{ id: 'shared-id', text: 'B own question?' }])
  })

  it('B pushing content IDENTICAL to A’s is stored for B: it is not told "duplicate" against a row that is A’s', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const q = question({ id: 'identical' })
    await pushOk(a, [rec('question', q)])
    await pushOk(a, [rec('question', question({ id: 'pad' }))]) // A's counter is ahead of B's, so a leaked version would show
    const res = await pushOk(b, [rec('question', q)])
    expect(res).toEqual([{ entityId: 'identical', status: 'applied', serverVersion: 1 }]) // no `conflict`, and B's own version
    expect(await rows('SELECT COUNT(*) AS n FROM records WHERE user_id = ?', b.id)).toEqual([{ n: 1 }])
    expect((await pull(b)).records).toMatchObject([{ id: 'identical' }])
  })

  it('B cannot overwrite or delete A’s record by pushing its id (the row it touches is B’s own)', async () => {
    const a = await account('a@example.com')
    const b = await account('b@example.com')
    const q = question({ id: 'aq' })
    await pushOk(a, [rec('question', q)])
    await pushOk(b, [delRec('question', q, 1)])
    expect(await rows('SELECT user_id, deleted_at FROM records ORDER BY user_id')).toHaveLength(2)
    expect((await pull(a)).records).toMatchObject([{ id: 'aq', deletedAt: null }])
  })
})

describe('one cursor over entries and records', () => {
  it('an entry and a record with the SAME id are two rows; each gets its own version from the one counter', async () => {
    const a = await account('a@example.com')
    const e = entry()
    const res = await pushOk(a, [ent(e), rec('entryState', entryState(e.id))])
    expect(res).toEqual([
      { entityId: e.id, status: 'applied', serverVersion: 1 },
      { entityId: e.id, status: 'applied', serverVersion: 2 },
    ])
    const page = await pull(a)
    expect(page.changes).toMatchObject([{ id: e.id, serverVersion: 1 }])
    expect(page.records).toMatchObject([{ recordKind: 'entryState', id: e.id, state: 'done', serverVersion: 2 }])
    expect(page.cursor).toBe(2)
  })

  it('two record KINDS sharing an id in one push are two rows, not one mutation deduplicated against the other', async () => {
    const a = await account('a@example.com')
    const state = entryState('same-id')
    const assessment = { id: 'same-id', entryId: 'n1', harnessVersion: 1, runId: 'run-1', at: iso(), deletedAt: null }
    const res = await pushOk(a, [rec('entryState', state), rec('assessment', assessment)])
    expect(res.map((r) => r.status)).toEqual(['applied', 'applied'])
    expect(await rows('SELECT kind FROM records ORDER BY kind')).toEqual([{ kind: 'assessment' }, { kind: 'entryState' }])
  })

  it('all seven kinds sharing one id in one push are applied together (the slot key is kind + id, not id)', async () => {
    const a = await account('a@example.com')
    const id = 'same-id'
    const lens = { id: 'builtin-daily-task-journal', name: 'Daily task journal', version: 1, shape: 'checklist', instruction: 'List commitments.' }
    const batch = [
      rec('assessment', { id, entryId: 'n1', harnessVersion: 1, runId: 'run-1', at: iso(), deletedAt: null }),
      rec('question', question({ id })),
      rec('link', { id, fromEntryId: 'n2', toEntryId: 'n1', kind: 'closes', onDate: null, state: 'proposed', evidence: 'x', runId: 'run-1', deletedAt: null }),
      rec('entryState', entryState(id)),
      rec('widget', { id, name: 'W', kind: 'prompt', active: true, lens, lineage: null, createdAt: iso(), updatedAt: iso(), deletedAt: null }),
      rec('report', { id, widgetId: 'w', lensVersion: 1, runId: 'run-1', entryIds: [], body: '- [ ] x', citations: [], executor: 'copy-prompt', ranAt: iso(), origin: 'ai-observation', droppedCitations: 0, deletedAt: null }),
      rec('run', { id, stage: 'harness', version: 1, widgetId: null, entryIds: [], ranAt: iso(), executor: 'copy-prompt', deletedAt: null }),
    ]
    const res = await pushOk(a, batch)
    expect(res.map((r) => r.status)).toEqual(Array(7).fill('applied')) // seven items, four rounds: only possible if none waits for another
    expect(await count('records')).toBe(7)
  })

  it('two kinds with one id, both already stored: each replay is judged against its OWN row', async () => {
    const a = await account('a@example.com')
    const state = entryState('same-id')
    const assessment = { id: 'same-id', entryId: 'n1', harnessVersion: 1, runId: 'run-1', at: iso(), deletedAt: null }
    await pushOk(a, [rec('entryState', state), rec('assessment', assessment)]) // versions 1 and 2
    const res = await pushOk(a, [rec('assessment', assessment), rec('entryState', state)])
    expect(res).toEqual([
      { entityId: 'same-id', status: 'duplicate', serverVersion: 2 },
      { entityId: 'same-id', status: 'duplicate', serverVersion: 1 },
    ])
    expect(await count('records')).toBe(2)
  })

  it('answers come back in the request order when entries and records are mixed', async () => {
    const a = await account('a@example.com')
    const e1 = entry()
    const q = question()
    const e2 = entry()
    const res = await pushOk(a, [ent(e1), rec('question', q), ent(e2), { ...rec('question', question()), recordKind: 'nope' }])
    expect(res.map((r) => [r.entityId, r.status])).toEqual([[e1.id, 'applied'], [q.id, 'applied'], [e2.id, 'applied'], [expect.any(String), 'rejected']])
  })

  it('pages merge by version: paging 2 at a time over 5 mixed changes returns each exactly once, in order, with a moving cursor', async () => {
    const a = await account('a@example.com')
    const e1 = entry()
    const e2 = entry()
    const q1 = question()
    const q2 = question()
    // Separate pushes so the interleaving is entry, record, entry, record, entry.
    await pushOk(a, [ent(e1)])
    await pushOk(a, [rec('question', q1)])
    await pushOk(a, [ent(e2)])
    await pushOk(a, [rec('question', q2)])
    const e3 = entry()
    await pushOk(a, [ent(e3)])

    const seen: Array<[string, number]> = []
    let cursor = 0
    let pages = 0
    for (;;) {
      const p = await pull(a, `?since=${cursor}&limit=2`)
      pages++
      for (const c of p.changes) seen.push([c.id as string, c.serverVersion as number])
      for (const r of p.records ?? []) seen.push([r.id as string, r.serverVersion as number])
      expect(p.cursor).toBeGreaterThan(cursor)
      cursor = p.cursor
      if (!p.more) break
      expect(pages).toBeLessThan(10)
    }
    expect(pages).toBe(3)
    expect(seen.sort((x, y) => x[1] - y[1])).toEqual([[e1.id, 1], [q1.id, 2], [e2.id, 3], [q2.id, 4], [e3.id, 5]])
    expect(cursor).toBe(5)
  })

  it('a pull with no records has no `records` key: the answer an older client has always had', async () => {
    const a = await account('a@example.com')
    await pushOk(a, [ent(entry())])
    const p = await pull(a)
    expect(Object.keys(p).sort()).toEqual(['changes', 'cursor', 'head', 'more'])
  })

  it('a records-only page still advances the cursor with `changes` empty (an older client skips past them)', async () => {
    const a = await account('a@example.com')
    await pushOk(a, [rec('question', question())])
    expect(await pull(a)).toMatchObject({ changes: [], cursor: 1, more: false, head: 1 })
  })
})

describe('push validation', () => {
  it('rejects, per mutation and without failing the batch: unknown kind, bad payload, id mismatch, delete without deletedAt, bad base', async () => {
    const a = await account('a@example.com')
    const q = question()
    const good = rec('question', question())
    const res = await pushOk(a, [
      { ...rec('question', q), recordKind: 'entry' },
      rec('question', { ...q, state: 'maybe' }),
      { ...rec('question', q), entityId: 'someone-else' },
      { ...rec('question', q), op: 'delete' },
      rec('question', q, 0),
      { ...rec('question', q), op: 'merge' },
      good,
    ])
    expect(res.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'applied'])
    expect(res[0]).toMatchObject({ error: 'recordKind: unknown' })
    expect(await count('records')).toBe(1)
  })

  it('refuses a record that breaks a cross-field rule (an answered question with no answer)', async () => {
    const a = await account('a@example.com')
    const res = await pushOk(a, [rec('question', question({ state: 'answered' }))])
    expect(res[0]).toMatchObject({ status: 'rejected' })
    expect(await count('records')).toBe(0)
  })
})

describe('stale edits and deletes keep what they replace', () => {
  it('an edit made against an older version is applied with the replaced content in record_revisions', async () => {
    const a = await account('a@example.com')
    const q = question({ id: 'q-edit' })
    await pushOk(a, [rec('question', q)]) // v1
    await pushOk(a, [rec('question', { ...q, state: 'answered', answer: 'The corner one', answeredAt: iso(5) }, 1)]) // v2, on base 1
    const res = await pushOk(a, [rec('question', { ...q, state: 'dismissed' }, 1)]) // made against v1, server is at v2
    expect(res[0]).toMatchObject({ status: 'applied', serverVersion: 3, conflict: true })
    const kept = await rows('SELECT server_version, data FROM record_revisions')
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ server_version: 2 })
    expect(JSON.parse(kept[0]!.data as string)).toMatchObject({ answer: 'The corner one', state: 'answered' }) // the owner's answer is not lost
  })

  it('a deleted record stays deleted when a stale edit arrives; its content is applied and the earlier one kept', async () => {
    const a = await account('a@example.com')
    const q = question({ id: 'q-del' })
    await pushOk(a, [rec('question', q)])
    await pushOk(a, [delRec('question', q, 1)]) // v2
    const res = await pushOk(a, [rec('question', { ...q, text: 'Edited later?' }, 1)])
    expect(res[0]).toMatchObject({ status: 'applied', conflict: true })
    const [row] = await rows('SELECT deleted_at, data FROM records')
    expect(row!.deleted_at).toBe(iso(30))
    expect(JSON.parse(row!.data as string)).toMatchObject({ text: 'Edited later?' })
    expect(await count('record_revisions')).toBe(1)
  })

  it('a push that loses a race between its read and its write goes round again, never overwrites blindly', async () => {
    const a = await account('a@example.com')
    const q = question({ id: 'q-race' })
    let raced = false
    const res = await pushRecords(env.DB, a.id, [rec('question', { ...q, text: 'Mine?' })], {
      afterRead: async () => {
        if (raced) return
        raced = true
        await pushRecords(env.DB, a.id, [rec('question', { ...q, text: 'Theirs?' })]) // another device lands first
      },
    })
    expect(raced).toBe(true)
    expect(res[0]).toMatchObject({ status: 'applied', conflict: true })
    const [row] = await rows('SELECT data FROM records')
    expect(JSON.parse(row!.data as string)).toMatchObject({ text: 'Mine?' })
    const kept = await rows('SELECT data FROM record_revisions')
    expect(kept).toHaveLength(1) // their write was kept, not lost
    expect(JSON.parse(kept[0]!.data as string)).toMatchObject({ text: 'Theirs?' })
  })
})

describe('the entry path is untouched', () => {
  it('an entry pushed with no recordKind behaves exactly as before, and its revisions table is not used by records', async () => {
    const a = await account('a@example.com')
    const e = entry()
    expect(await pushOk(a, [ent(e)])).toEqual([{ entityId: e.id, status: 'applied', serverVersion: 1 }])
    expect(await count('entries')).toBe(1)
    expect(await count('records')).toBe(0)
    expect(await count('entry_revisions')).toBe(0)
  })
})
