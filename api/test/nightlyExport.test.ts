// R6 — the nightly export (src/nightlyExport.ts). GitHub is a fake repo in memory that behaves like the Git Data API where
// the export relies on it (blob ids, subtree listings, `recursive`, base_tree deletes, a refused non-forced ref move), so
// every claim is checked against the tree a run leaves behind. Scope (D-122 Q1) is held with a second account present that
// holds a row in every table the export reads, each first shown to exist.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pushMutations } from '../src/entries'
import { pushRecords } from '../src/records'
import { blobSha, buildFiles, runNightlyExport } from '../src/nightlyExport'
import worker from '../src/index'
import type { Env } from '../src/index'

const REPO = 'owner/planner-data'
const OWNER = 'owner@example.com'
const SHARED_ID = '00000000-0000-4000-8000-999999999999'
const exportEnv = (over: Partial<Env> = {}): Env =>
  ({ ...env, EXPORT_REPO: REPO, EXPORT_GITHUB_TOKEN: 'github_pat_test_0000000000000000000000', EXPORT_ACCOUNT_EMAIL: OWNER, ...over }) as Env

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, 'Name', Date.now()).run()
  return id
}

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const entry = (createdAt: string, body: string, id = uuid()) => ({
  id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null,
})
const upsert = (p: ReturnType<typeof entry>, baseVersion: number | null = null) => ({ entityId: p.id, op: 'upsert', baseVersion, payload: p })
const question = (id: string, text: string) => ({
  id, entryId: 'x', text, state: 'open', answer: null as string | null, createdAt: '2026-10-10T08:00:00.000Z', answeredAt: null as string | null, runId: 'r', deletedAt: null,
})
const recUpsert = (p: ReturnType<typeof question>, baseVersion: number | null = null) =>
  ({ recordKind: 'question', entityId: p.id, op: 'upsert', baseVersion, payload: p })

type Opts = { status?: number; moveHeadBeforePatch?: boolean; truncated?: boolean }

/**
 * A repo in memory. A commit points at a flat path → content map; any directory's tree sha is a hash of the map under
 * it, so equal content = equal sha, as in git. Listings are one level unless `?recursive=1`, as on GitHub.
 */
async function fakeGithub(start: Record<string, string> = { 'README.md': 'data\n' }, opts: Opts = {}) {
  const trees = new Map<string, Map<string, string>>() // sha → files relative to that directory
  const commits = new Map<string, { tree: string; message: string }>()
  const register = (files: Map<string, string>) => {
    const s = JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)))
    let h = 0
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
    const sha = `t${(h >>> 0).toString(16)}${s.length}`
    trees.set(sha, new Map(files))
    return sha
  }
  const under = (files: Map<string, string>, dir: string) =>
    new Map([...files].filter(([p]) => p.startsWith(`${dir}/`)).map(([p, c]) => [p.slice(dir.length + 1), c]))
  const listing = async (files: Map<string, string>, recursive: boolean) => {
    const out: { path: string; type: string; sha: string }[] = []
    const dirs = new Set<string>()
    for (const [p, c] of files) {
      const slash = p.indexOf('/')
      if (slash < 0 || recursive) out.push({ path: p, type: 'blob', sha: await blobSha(c) })
      if (slash >= 0 && !recursive) dirs.add(p.slice(0, slash))
    }
    for (const d of dirs) out.push({ path: d, type: 'tree', sha: register(under(files, d)) })
    return out
  }
  commits.set('c0', { tree: register(new Map(Object.entries(start))), message: 'init' })
  const state = { head: 'c0', patches: 0, uploads: [] as string[], calls: [] as string[] }
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    state.calls.push(`${method} ${url.pathname}`)
    if (opts.status) return new Response('{}', { status: opts.status })
    const p = url.pathname.replace(`/repos/${REPO}`, '')
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (method === 'GET' && p === '') return Response.json({ default_branch: 'main' })
    if (method === 'GET' && p === '/git/ref/heads/main') return Response.json({ object: { sha: state.head } })
    if (method === 'GET' && p.startsWith('/git/commits/')) return Response.json({ tree: { sha: commits.get(p.split('/').pop()!)!.tree } })
    if (method === 'GET' && p.startsWith('/git/trees/')) {
      const files = trees.get(p.split('/').pop()!)!
      return Response.json({ tree: await listing(files, url.searchParams.get('recursive') === '1'), truncated: !!opts.truncated })
    }
    if (method === 'POST' && p === '/git/trees') {
      const files = new Map(trees.get(body.base_tree)!)
      for (const t of body.tree) {
        if (t.sha === null) files.delete(t.path)
        else { files.set(t.path, t.content); state.uploads.push(t.path) }
      }
      return Response.json({ sha: register(files) })
    }
    if (method === 'POST' && p === '/git/commits') {
      const sha = `c${commits.size}`
      commits.set(sha, { tree: body.tree, message: body.message })
      return Response.json({ sha })
    }
    if (method === 'PATCH' && p === '/git/refs/heads/main') {
      if (body.force !== false) return new Response('force must be false', { status: 400 })
      if (opts.moveHeadBeforePatch) return new Response('{"message":"Update is not a fast forward"}', { status: 422 })
      state.patches++
      state.head = body.sha
      return Response.json({ object: { sha: body.sha } })
    }
    return new Response('not found', { status: 404 })
  })
  const files = () => trees.get(commits.get(state.head)!.tree)!
  return { state, spy, files, commits }
}

const errorKinds = async () =>
  (await env.DB.prepare('SELECT kind, route FROM error_log ORDER BY id').all<{ kind: string; route: string }>()).results
const countWhere = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n

afterEach(() => vi.restoreAllMocks())

describe('R6 nightly export', () => {
  it('blobSha is git\'s blob id (known value for "hello\\n")', async () => {
    expect(await blobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('exports the named account only, with a second account in every table it reads (D-122 Q1)', async () => {
    const owner = await account(OWNER)
    const other = await account('tester@example.com')
    // The same entity and record ids on both accounts (the keys include user_id): a lookup by id alone would cross over.
    const shared = entry('2026-10-10T08:00:00.000Z', 'owner note', SHARED_ID)
    await pushMutations(env.DB, owner, [upsert(shared)])
    await pushRecords(env.DB, owner, [recUpsert(question('q-shared', 'owner question?'))])
    const t = entry('2026-10-10T08:00:00.000Z', 'tester first', SHARED_ID)
    await pushMutations(env.DB, other, [upsert(t)])
    await pushMutations(env.DB, other, [upsert({ ...t, body: 'tester second' }, null)]) // stale base → a tester revision
    const [first] = await pushRecords(env.DB, other, [recUpsert(question('q-shared', 'tester question?'))])
    await pushRecords(env.DB, other, [recUpsert({ ...question('q-shared', 'tester replaced?'), state: 'answered', answer: 'tester answer', answeredAt: '2026-10-10T09:00:00.000Z' }, first!.serverVersion!)])
    await pushRecords(env.DB, other, [recUpsert(question('q-shared', 'tester stale?'), first!.serverVersion!)]) // → record revision
    const now = Date.now()
    await env.DB.prepare(`INSERT INTO models (user_id, id, label, format, base_url, model, max_tokens, created_at, updated_at)
      VALUES (?, 'm1', 'tester model', 'openai-chat', 'https://llm.example.com/v1', 'tester-m', 1000, ?, ?)`).bind(other, now, now).run()
    await env.DB.prepare(`INSERT INTO ai_calls (user_id, id, model_id, stage, run_id, entry_count, prompt_bytes, status, reply, started_at, finished_at)
      VALUES (?, 'call-1', 'm1', 'harness', 'r', 1, 10, 'ok', 'tester reply', ?, ?)`).bind(other, now, now).run()
    await env.DB.prepare(`INSERT INTO integrations (user_id, provider, key_ct, key_iv, key_hint, key_version, login, created_at, updated_at)
      VALUES (?, 'github', 'ct', 'iv', 'tstr', 1, 'tester-login', ?, ?)`).bind(other, now, now).run()
    await env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('google', 'tester-google', ?)").bind(other).run()
    // Known positives: the tester's rows are really there, one per read the export makes.
    expect(await countWhere("SELECT COUNT(*) AS n FROM entries WHERE body = 'tester second'")).toBe(1)
    expect(await countWhere("SELECT COUNT(*) AS n FROM entry_revisions WHERE body = 'tester first'")).toBe(1)
    expect(await countWhere("SELECT COUNT(*) AS n FROM records WHERE data LIKE '%tester%'")).toBe(1)
    expect(await countWhere("SELECT COUNT(*) AS n FROM record_revisions WHERE data LIKE '%tester%'")).toBe(1)
    for (const table of ['models', 'ai_calls', 'integrations', 'identities']) {
      expect(await countWhere(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = '${other}'`), table).toBe(1)
    }
    const gh = await fakeGithub()
    expect(await runNightlyExport(exportEnv())).toMatchObject({ status: 'committed', entries: 1 })
    const all = [...gh.files().values()].join('\n')
    expect(all).toContain('owner note')
    expect(all).toContain('owner question?')
    expect(all).toContain(OWNER)
    expect(all).not.toContain('tester')
    expect(all).not.toContain('google')
    expect(gh.files().get('README.md')).toBe('data\n') // paths outside export/ are left alone
  })

  it('splits entries by month of createdAt, with each revision in its entry\'s month', async () => {
    const owner = await account(OWNER)
    const sep = entry('2026-09-30T23:00:00.000Z', 'september first text')
    const oct = entry('2026-10-01T00:30:00.000Z', 'october text')
    await pushMutations(env.DB, owner, [upsert(sep), upsert(oct)])
    await pushMutations(env.DB, owner, [upsert({ ...sep, body: 'september second text' }, null)]) // stale base → revision
    const files = await buildFiles(env.DB, owner)
    const s = JSON.parse(files.get('export/entries/2026-09.json')!)
    const o = JSON.parse(files.get('export/entries/2026-10.json')!)
    expect(s.entries.map((e: { body: string }) => e.body)).toEqual(['september second text'])
    expect(s.revisions.map((r: { body: string }) => r.body)).toEqual(['september first text'])
    expect(o.entries.map((e: { body: string }) => e.body)).toEqual(['october text'])
    expect(o.revisions).toEqual([])
    expect(JSON.parse(files.get('export/meta.json')!)).toMatchObject({ months: ['2026-09', '2026-10'], counts: { entries: 2, revisions: 1 } })
  })

  it('reads every page: a page size of 2 gives the same files as one page', async () => {
    const owner = await account(OWNER)
    await pushMutations(env.DB, owner, [1, 2, 3, 4, 5].map((d) => upsert(entry(`2026-0${d}-02T08:00:00.000Z`, `note ${d}`))))
    const paged = await buildFiles(env.DB, owner, 2)
    expect(JSON.parse(paged.get('export/meta.json')!)).toMatchObject({ cursor: 5, counts: { entries: 5 } })
    expect([...paged]).toEqual([...(await buildFiles(env.DB, owner))])
  })

  it('a row edited between two pages is written once, at its newer version', async () => {
    const owner = await account(OWNER)
    const a = entry('2026-10-01T08:00:00.000Z', 'a old')
    await pushMutations(env.DB, owner, [upsert(a), upsert(entry('2026-10-02T08:00:00.000Z', 'b')), upsert(entry('2026-10-03T08:00:00.000Z', 'c'))])
    // Edit `a` (already on page 1) while the export reads page 2: the second D1 read sees it again, above the cursor.
    const real = env.DB.batch.bind(env.DB)
    let batches = 0
    vi.spyOn(env.DB, 'batch').mockImplementation(async (stmts) => {
      if (++batches === 2) await pushMutations(env.DB, owner, [upsert({ ...a, body: 'a new' }, 1)])
      return real(stmts)
    })
    const files = await buildFiles(env.DB, owner, 2)
    const oct = JSON.parse(files.get('export/entries/2026-10.json')!)
    expect(batches).toBeGreaterThanOrEqual(2) // known positive: the edit really landed mid-export
    expect(oct.entries.map((e: { body: string }) => e.body)).toEqual(['b', 'c', 'a new'])
    expect(JSON.parse(files.get('export/meta.json')!).counts.entries).toBe(3)
  })

  it('a night with no change sends nothing; a changed night uploads only the changed files', async () => {
    const owner = await account(OWNER)
    await pushMutations(env.DB, owner, [upsert(entry('2026-09-10T08:00:00.000Z', 'one'))])
    const gh = await fakeGithub()
    expect((await runNightlyExport(exportEnv())).status).toBe('committed')
    expect(gh.state.patches).toBe(1)
    gh.state.uploads = []
    const before = gh.state.calls.length
    expect((await runNightlyExport(exportEnv())).status).toBe('unchanged')
    expect(gh.state.patches).toBe(1) // the ref did not move
    expect(gh.state.calls.slice(before).filter((c) => !c.startsWith('GET'))).toEqual([]) // no tree, no commit
    await pushMutations(env.DB, owner, [upsert(entry('2026-10-11T08:00:00.000Z', 'two'))])
    expect((await runNightlyExport(exportEnv())).status).toBe('committed')
    expect(gh.state.patches).toBe(2)
    // September's file, records.json and account.json are unchanged, so they are not sent again.
    expect(gh.state.uploads.sort()).toEqual(['export/entries/2026-10.json', 'export/meta.json'])
  })

  it('removes an export file no longer produced, nested ones included, and keeps other paths', async () => {
    const owner = await account(OWNER)
    await pushMutations(env.DB, owner, [upsert(entry('2026-10-10T08:00:00.000Z', 'kept'))])
    const gh = await fakeGithub({ 'README.md': 'data\n', 'export/entries/2025-01.json': '{}\n', 'export/old.json': '{}\n', 'trial/lens.md': 'lens\n' })
    await runNightlyExport(exportEnv())
    expect([...gh.files().keys()].sort()).toEqual([
      'README.md', 'export/account.json', 'export/entries/2026-10.json', 'export/meta.json', 'export/records.json', 'trial/lens.md',
    ])
  })

  it('a truncated export listing makes no commit and logs export.tree-truncated', async () => {
    await account(OWNER)
    const gh = await fakeGithub({ 'export/meta.json': '{}\n' }, { truncated: true })
    expect(await runNightlyExport(exportEnv())).toEqual({ status: 'failed', reason: 'tree-truncated' })
    expect(gh.state.patches).toBe(0)
    expect(await errorKinds()).toEqual([{ kind: 'export.tree-truncated', route: '/cron/export' }])
  })

  it('a branch that moved during the run is not overwritten: 422, logged, head unchanged', async () => {
    const owner = await account(OWNER)
    await pushMutations(env.DB, owner, [upsert(entry('2026-10-10T08:00:00.000Z', 'one'))])
    const gh = await fakeGithub(undefined, { moveHeadBeforePatch: true })
    expect(await runNightlyExport(exportEnv())).toEqual({ status: 'failed', reason: 'github-422' })
    expect(gh.state.head).toBe('c0')
    expect(await errorKinds()).toEqual([{ kind: 'export.github-422', route: '/cron/export' }])
  })

  it('without its secrets logs export.not-configured and calls nobody', async () => {
    await account(OWNER)
    const gh = await fakeGithub()
    expect(await runNightlyExport(exportEnv({ EXPORT_GITHUB_TOKEN: undefined }))).toEqual({ status: 'failed', reason: 'not-configured' })
    expect(gh.state.calls).toEqual([])
    expect(await errorKinds()).toEqual([{ kind: 'export.not-configured', route: '/cron/export' }])
  })

  it('an email that matches no account, or a malformed repo, logs and calls nobody', async () => {
    await account('someone@example.com')
    const gh = await fakeGithub()
    expect(await runNightlyExport(exportEnv())).toEqual({ status: 'failed', reason: 'no-account' })
    expect(await runNightlyExport(exportEnv({ EXPORT_REPO: 'not a repo' }))).toEqual({ status: 'failed', reason: 'bad-repo' })
    expect(gh.state.calls).toEqual([])
    expect((await errorKinds()).map((e) => e.kind)).toEqual(['export.no-account', 'export.bad-repo'])
  })

  it('a GitHub refusal logs its status and moves no ref', async () => {
    await account(OWNER)
    const gh = await fakeGithub(undefined, { status: 401 })
    expect(await runNightlyExport(exportEnv())).toEqual({ status: 'failed', reason: 'github-401' })
    expect(gh.state.patches).toBe(0)
    expect(await errorKinds()).toEqual([{ kind: 'export.github-401', route: '/cron/export' }])
  })

  it('the Worker\'s scheduled handler runs it', async () => {
    const owner = await account(OWNER)
    await pushMutations(env.DB, owner, [upsert(entry('2026-10-10T08:00:00.000Z', 'from cron'))])
    const gh = await fakeGithub()
    const waits: Promise<unknown>[] = []
    worker.scheduled({} as ScheduledController, exportEnv(), { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext)
    await Promise.all(waits)
    expect(gh.state.patches).toBe(1)
    expect(gh.commits.get(gh.state.head)!.message).toMatch(/^export: \d{4}-\d{2}-\d{2} \(1 entries\)$/)
  })
})
