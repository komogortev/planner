// GitHub bridge G2 — the repo list and a project's state (docs/GITHUB-BRIDGE.md §5–6). GitHub is stubbed by URL. Each
// refusal is paired with the same request succeeding for the owner, so "refused" cannot pass because nothing worked.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/auth'
import { pushRecords } from '../src/records'
import { CLAUDE_ASK, cutSnapshot, DEFAULT_CONFIG, issueBody, lastBotLine, linkedPr, parseConfig, recentSent, SIGN_OFF, usesClaudeAction, type SentIssue } from '../src/projects'
import { projectWidgetRow } from '../../src/widgets/projects'
import app from '../src/index'

const API = 'https://api.test'
const TOKEN = 'github_pat_11AAAAAAA0THIS_IS_THE_SECRET_TOKEN_9z8y'
const NOW = '2026-10-16T10:00:00.000Z'
const STATE = '# X — STATE\n\n## SNAPSHOT\n- **Phase:** G2\n- **Working:** prod\n---\n\n## Context\nlong text that must not show'

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}
const call = (token: string, path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }), env)

type Route = (url: URL) => Response | undefined
/** GitHub stubbed by URL; anything not routed is a 404, as GitHub answers for a file that is not there. */
function github(...routes: Route[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/user') return Response.json({ login: 'octo' })
    for (const r of routes) { const res = r(url); if (res) return res }
    return Response.json({ message: 'Not Found' }, { status: 404 })
  })
}
const file = (path: string, body: string): Route => (u) => (u.pathname.endsWith(`/contents/${path}`) ? new Response(body) : undefined)
const pulls = (list: unknown[]): Route => (u) => (u.pathname.endsWith('/pulls') ? Response.json(list) : undefined)
const ghCalls = (spy: ReturnType<typeof github>) => spy.mock.calls.map(([u]) => new URL(String(u)).pathname).filter((p) => p !== '/user')

async function connected(email: string) {
  const a = await account(email)
  github()
  expect((await call(a.token, '/me/integrations/github', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) })).status).toBe(200)
  vi.restoreAllMocks()
  return a
}
async function addProject(userId: string, repo: string, active = true) {
  const row = projectWidgetRow(repo, false, active, NOW)
  const [r] = await pushRecords(env.DB, userId, [{ recordKind: 'widget', entityId: row.id, op: 'upsert', baseVersion: null, payload: { ...row, deletedAt: null } }])
  expect(r).toMatchObject({ status: 'applied' })
}
afterEach(() => vi.restoreAllMocks())

describe('GET /me/integrations/github/repos', () => {
  it("lists the repos the user's token reaches, sending that token", async () => {
    const a = await connected('a@example.com')
    const spy = github((u) => (u.pathname === '/user/repos'
      ? Response.json([{ full_name: 'komogortev/planner', private: false, pushed_at: NOW }, { full_name: 'komogortev/Projects', private: true, pushed_at: null }, { full_name: 'bad name' }])
      : undefined))
    const res = await call(a.token, '/me/integrations/github/repos')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ repos: [
      { fullName: 'komogortev/planner', private: false, pushedAt: NOW },
      { fullName: 'komogortev/Projects', private: true, pushedAt: null },
    ] })
    const [, init] = spy.mock.calls.find(([u]) => String(u).includes('/user/repos'))! as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect(spy.mock.calls.filter(([u]) => String(u).includes('/user/repos'))).toHaveLength(1) // fewer than 100: one page
  })

  it('says GitHub is not connected (409, not 401: the app must not sign out)', async () => {
    const a = await account('a@example.com')
    const spy = github()
    const res = await call(a.token, '/me/integrations/github/repos')
    expect(res.status).toBe(409)
    expect(spy).not.toHaveBeenCalled()
  })

  it('a token GitHub now refuses asks to reconnect, as 409', async () => {
    const a = await connected('a@example.com')
    github((u) => (u.pathname === '/user/repos' ? Response.json({ message: 'Bad credentials' }, { status: 401 }) : undefined))
    const res = await call(a.token, '/me/integrations/github/repos')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/Reconnect/)
  })
})

describe('GET /projects/state', () => {
  it("reads the repo's config, its STATE snapshot and its last merges", async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    const spy = github(
      file('.planner.json', JSON.stringify({ title: 'Planner', state: 'docs/STATE.md', show: ['snapshot', 'merges'] })),
      file('docs/STATE.md', STATE),
      pulls([
        { number: 7, title: 'closed unmerged', merged_at: null, html_url: 'https://github.com/komogortev/planner/pull/7' },
        { number: 5, title: 'older', merged_at: '2026-10-14T10:00:00Z', html_url: 'https://github.com/komogortev/planner/pull/5' },
        { number: 6, title: 'newer', merged_at: '2026-10-15T10:00:00Z', html_url: 'https://evil.example/6' },
      ]),
      (u) => (u.pathname.endsWith('/issues') ? Response.json([]) : undefined),
    )
    const res = await call(a.token, `/projects/state?repo=${encodeURIComponent('komogortev/planner')}`)
    expect(res.status).toBe(200)
    const out = (await res.json()) as Record<string, unknown>
    expect(out).toMatchObject({
      repo: 'komogortev/planner', configSource: 'file', configError: null,
      config: { title: 'Planner', state: 'docs/STATE.md', show: ['snapshot', 'merges'] },
      snapshot: { found: true, text: '- **Phase:** G2\n- **Working:** prod', path: 'docs/STATE.md' },
      merges: [
        { number: 6, title: 'newer', mergedAt: '2026-10-15T10:00:00Z', url: 'https://github.com/komogortev/planner/pull/6' }, // a foreign link is replaced
        { number: 5, title: 'older', mergedAt: '2026-10-14T10:00:00Z', url: 'https://github.com/komogortev/planner/pull/5' },
      ],
    })
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    expect(ghCalls(spy)).toEqual([
      '/repos/komogortev/planner/contents/.planner.json', '/repos/komogortev/planner/contents/docs/STATE.md', '/repos/komogortev/planner/pulls',
      '/repos/komogortev/planner/issues', '/repos/komogortev/planner/issues', '/repos/komogortev/planner/contents/.github/workflows',
    ])
    expect(out.claude).toBe(false) // no workflows folder
    expect(out.issues).toEqual([]) // the stub has no issues: the list is empty, not an error
  })

  it('without .planner.json: the defaults, and the card is told so', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    github(file('docs/STATE.md', STATE), pulls([]))
    const out = (await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as Record<string, unknown>
    expect(out).toMatchObject({ configSource: 'default', config: DEFAULT_CONFIG, merges: [] })
  })

  it('a config that shows only the snapshot never asks GitHub for pull requests', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    const spy = github(file('.planner.json', '{"show":["snapshot"]}'), file('docs/STATE.md', STATE))
    const out = (await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as Record<string, unknown>
    expect(out.merges).toBeNull()
    expect(ghCalls(spy).some((p) => p.endsWith('/pulls'))).toBe(false)
  })

  it('ownership ignores case, as GitHub names do', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/Planner')
    github(file('docs/STATE.md', STATE), pulls([]))
    expect((await call(a.token, '/projects/state?repo=KOMOGORTEV/planner')).status).toBe(200)
  })

  it('a renamed repo (GitHub answers 301) asks to switch it on again, and a file over 1 MB is refused', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    github(() => new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/1' } }))
    const moved = await call(a.token, '/projects/state?repo=komogortev/planner')
    expect(moved.status).toBe(409)
    expect(((await moved.json()) as { error: string }).error).toMatch(/renamed or moved/)
    vi.restoreAllMocks()
    github(file('docs/STATE.md', 'x'.repeat(1_000_001)), pulls([]))
    const big = (await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as { snapshot: unknown }
    expect(big.snapshot).toEqual({ error: 'docs/STATE.md is over 1 MB', path: 'docs/STATE.md' })
  })

  it('a missing STATE file is a line on the card, not a failure', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    github(pulls([]))
    const res = await call(a.token, '/projects/state?repo=komogortev/planner')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { snapshot: unknown }).snapshot).toEqual({ error: 'No file at docs/STATE.md', path: 'docs/STATE.md' })
  })

  it("refuses a repo that is not one of the caller's projects, before asking GitHub; B never reads A's project", async () => {
    const a = await connected('a@example.com')
    const b = await connected('b@example.com')
    await addProject(a.id, 'komogortev/planner')
    const spy = github(file('docs/STATE.md', STATE), pulls([]))
    expect((await call(a.token, '/projects/state?repo=komogortev/planner')).status).toBe(200) // exercised: A can
    spy.mockClear()
    expect((await call(b.token, '/projects/state?repo=komogortev/planner')).status).toBe(404)
    expect((await call(a.token, '/projects/state?repo=komogortev/other')).status).toBe(404)
    expect(ghCalls(spy)).toEqual([])
  })

  it('a switched-off project is still readable (its card may be open), but a malformed repo is refused', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner', false)
    github(file('docs/STATE.md', STATE), pulls([]))
    expect((await call(a.token, '/projects/state?repo=komogortev/planner')).status).toBe(200)
    expect((await call(a.token, '/projects/state?repo=..%2F..%2Fuser')).status).toBe(400)
    expect((await call(a.token, '/projects/state?repo=komogortev%2F..')).status).toBe(400)
  })

  it("GitHub's rate limit is a 429 that names when to try again", async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    github(() => Response.json({ message: 'rate limit' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 9, 16, 11, 30) / 1000) } }))
    const res = await call(a.token, '/projects/state?repo=komogortev/planner')
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: string }).error).toMatch(/11:30 UTC/)
  })
})

describe('parseConfig', () => {
  it('takes each valid key, defaults each invalid one, and names what it ignored', () => {
    expect(parseConfig('{"title":"P","state":"STATE.md","show":["merges"]}')).toEqual({ config: { title: 'P', state: 'STATE.md', show: ['merges'], brief: ['Next'], issues: [] }, error: null })
    expect(parseConfig('{"state":"../secrets","show":["issues"],"extra":1}')).toEqual({
      config: DEFAULT_CONFIG, error: '.planner.json: ignored state, show, extra',
    })
    for (const bad of ['/etc/passwd', 'a/../b', './x', 'a//b', 'x'.repeat(201)]) expect(parseConfig(JSON.stringify({ state: bad })).config.state, bad).toBe('docs/STATE.md')
    expect(parseConfig('not json')).toEqual({ config: DEFAULT_CONFIG, error: '.planner.json is not JSON' })
    expect(parseConfig('[]').error).toBe('.planner.json is not an object')
  })

  it('brief: 1–4 labels of up to 30 chars, trimmed and deduplicated; anything else falls back to ["Next"] and is named', () => {
    expect(parseConfig('{"brief":[" Next ","Broken","Next"]}')).toEqual({ config: { ...DEFAULT_CONFIG, brief: ['Next', 'Broken'] }, error: null })
    expect(parseConfig('{"brief":["Next","next"]}').config.brief).toEqual(['Next']) // the card matches labels case-insensitively
    for (const bad of [[], ['a', 'b', 'c', 'd', 'e'], [''], ['  '], ['x'.repeat(31)], [1], 'Next', null]) {
      expect(parseConfig(JSON.stringify({ brief: bad })), JSON.stringify(bad)).toEqual({ config: DEFAULT_CONFIG, error: '.planner.json: ignored brief' })
    }
  })
})

describe('parseConfig issues (C2)', () => {
  it('takes kinds with their labels; one bad kind refuses the whole key and names it', () => {
    expect(parseConfig('{"issues":[{"name":" Bug ","labels":["bug"]},{"name":"Task"}]}')).toEqual({
      config: { ...DEFAULT_CONFIG, issues: [{ name: 'Bug', labels: ['bug'] }, { name: 'Task', labels: [] }] }, error: null,
    })
    for (const bad of [
      [], 'Bug', [{ name: '' }], [{ name: 'x'.repeat(25) }], [{ name: 'Bug' }, { name: 'bug' }], [{ name: 'Bug', extra: 1 }],
      [{ name: 'Bug', labels: ['a,b'] }], [{ name: 'Bug', labels: ['a', 'b', 'c', 'd'] }], [{ name: 'Bug', labels: 'bug' }],
      Array.from({ length: 9 }, (_, i) => ({ name: `k${i}` })), [null],
    ]) {
      expect(parseConfig(JSON.stringify({ issues: bad })), JSON.stringify(bad)).toEqual({ config: DEFAULT_CONFIG, error: '.planner.json: ignored issues' })
    }
  })
})

describe('GET /projects/state: the issues the planner sent (C2)', () => {
  it('lists planner-labelled issues by this login, newest first, without pull requests', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    const spy = github(file('docs/STATE.md', STATE), pulls([]), (u) => (u.pathname.endsWith('/issues') ? Response.json([
      { number: 9, title: 'a PR', created_at: NOW, pull_request: {}, html_url: 'https://github.com/komogortev/planner/pull/9' },
      { number: 8, title: 'Fix the card', created_at: NOW, html_url: 'https://github.com/komogortev/planner/issues/8' },
      { number: 7, title: 'foreign link', created_at: NOW, html_url: 'https://evil.example/7' },
    ]) : undefined))
    const out = (await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as Record<string, unknown>
    expect(out.issues).toEqual([
      { number: 8, title: 'Fix the card', createdAt: NOW, url: 'https://github.com/komogortev/planner/issues/8', state: 'open', closedAt: null, bot: null, pr: null },
      { number: 7, title: 'foreign link', createdAt: NOW, url: 'https://github.com/komogortev/planner/issues/7', state: 'open', closedAt: null, bot: null, pr: null },
    ])
    const q = new URL(String(spy.mock.calls.find(([u]) => String(u).includes('/issues'))![0])).searchParams
    expect([q.get('labels'), q.get('creator'), q.get('state')]).toEqual(['planner', 'octo', 'open'])
  })
})

describe('POST /projects/issue (C2)', () => {
  const RID = '0b6c3f0e-6a51-4d0c-9a3b-2f1e5d7c8a90'
  type Sent = { method: string; path: string; body: Record<string, unknown> | null }
  /** GitHub stubbed with methods: a repo holding `existing` issues; records every call. */
  function githubWrite(opts: { existing?: unknown[]; config?: string; listStatus?: number; createStatus?: number } = {}) {
    const sent: Sent[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      if (url.pathname === '/user') return Response.json({ login: 'octo' })
      sent.push({ method, path: url.pathname, body })
      if (url.pathname.endsWith('/contents/.planner.json')) return opts.config ? new Response(opts.config) : Response.json({}, { status: 404 })
      if (url.pathname.endsWith('/issues') && method === 'GET') return Response.json(opts.existing ?? [], { status: opts.listStatus ?? 200 })
      if (url.pathname.endsWith('/labels')) return Response.json({}, { status: body?.name === 'planner' ? 422 : 201 })
      if (url.pathname.endsWith('/issues') && method === 'POST') {
        return Response.json({ number: 12, title: body?.title, created_at: NOW, html_url: 'https://github.com/komogortev/planner/issues/12' }, { status: opts.createStatus ?? 201 })
      }
      return Response.json({ message: 'Not Found' }, { status: 404 })
    })
    return sent
  }
  const send = (token: string, extra: Record<string, unknown> = {}) =>
    call(token, '/projects/issue', { method: 'POST', body: JSON.stringify({ repo: 'komogortev/planner', title: ' Fix the card ', body: 'Steps', requestId: RID, ...extra }) })
  const creates = (sent: Sent[]) => sent.filter((s) => s.method === 'POST' && s.path.endsWith('/issues'))

  it('sends one issue with the kind\'s labels and the request marker, and answers with it', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    const sent = githubWrite({ config: '{"issues":[{"name":"Bug","labels":["bug"]}]}' })
    const res = await send(a.token, { kind: 'bug' })
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out).toEqual({ issue: { number: 12, title: 'Fix the card', createdAt: NOW, url: 'https://github.com/komogortev/planner/issues/12', state: 'open', closedAt: null }, created: true })
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    expect(sent.filter((s) => s.path.endsWith('/labels')).map((s) => s.body?.name)).toEqual(['planner', 'bug'])
    expect(creates(sent)).toEqual([{ method: 'POST', path: '/repos/komogortev/planner/issues', body: {
      title: 'Fix the card', body: `Steps\n\n${SIGN_OFF}\n\n<!-- planner:${RID} -->`, labels: ['planner', 'bug'],
    } }])
  })

  it('a retried send finds the first issue by its request id and creates no second one', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    const sent = githubWrite({ existing: [{ number: 12, title: 'Fix the card', created_at: NOW, body: `Steps\n\n<!-- planner:${RID} -->`, html_url: 'https://github.com/komogortev/planner/issues/12' }] })
    const res = await send(a.token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ issue: { number: 12, title: 'Fix the card', createdAt: NOW, url: 'https://github.com/komogortev/planner/issues/12', state: 'open', closedAt: null }, created: false })
    expect(creates(sent)).toEqual([])
    // Known positive for the same stub: another request id does create.
    const other = await send(a.token, { requestId: '1b6c3f0e-6a51-4d0c-9a3b-2f1e5d7c8a90' })
    expect(other.status).toBe(201)
  })

  it("B cannot send to A's repo: 404 before any GitHub call", async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    const b = await connected('b@example.com')
    const sent = githubWrite()
    expect((await send(b.token)).status).toBe(404)
    expect(sent).toEqual([])
    expect((await send(a.token)).status).toBe(201) // the same request from the owner goes through
  })

  it('refuses bad input before GitHub, a kind the repo does not declare, and a send it cannot check for an earlier one', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    let sent = githubWrite()
    for (const extra of [{ title: '  ' }, { title: 'x'.repeat(201) }, { body: 'x'.repeat(10_001) }, { requestId: 'r1' }, { kind: 3 }, { repo: 'nope' }]) {
      expect((await send(a.token, extra)).status, JSON.stringify(extra).slice(0, 40)).toBe(400)
    }
    expect(sent).toEqual([])
    vi.restoreAllMocks()
    sent = githubWrite({ config: '{"issues":[{"name":"Bug"}]}' })
    const unknown = await send(a.token, { kind: 'Idea' })
    expect(unknown.status).toBe(409)
    expect(((await unknown.json()) as { error: string }).error).toMatch(/not an issue kind/)
    expect(creates(sent)).toEqual([])
    vi.restoreAllMocks()
    sent = githubWrite({ listStatus: 403 })
    const blind = await send(a.token)
    expect(blind.status).toBe(409)
    expect(((await blind.json()) as { error: string }).error).toMatch(/Issues: Read and write.*No issue was sent/)
    expect(creates(sent)).toEqual([])
  })

  it('a 5xx on create may hide a made issue: it says so instead of "nothing was sent"; a secondary limit is not a permission problem', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    githubWrite({ createStatus: 502 })
    const flaky = await send(a.token)
    expect(flaky.status).toBe(502)
    const msg = ((await flaky.json()) as { error: string }).error
    expect(msg).toMatch(/may have been sent/)
    expect(msg).not.toMatch(/Nothing was sent|No issue was sent/)
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (new URL(String(input)).pathname === '/user'
      ? Response.json({ login: 'octo' })
      : Response.json({ message: 'You have exceeded a secondary rate limit' }, { status: 403, headers: { 'retry-after': '60' } })))
    const limited = await send(a.token)
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as { error: string }).error).toMatch(/limiting/)
  })

  it('a create GitHub refuses says what the token lacks', async () => {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    githubWrite({ createStatus: 403 })
    const res = await send(a.token)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/Issues: Read and write/)
  })
})

describe('C3 loop back: pure parts', () => {
  const sent = (n: number, state: 'open' | 'closed', closedAt: string | null): SentIssue => ({ number: n, title: 't', url: 'u', createdAt: NOW, state, closedAt })

  it('keeps open issues and those closed in the last 7 days', () => {
    const now = Date.parse(NOW)
    const out = recentSent([sent(1, 'open', null), sent(2, 'closed', new Date(now - 6 * 86_400_000).toISOString()), sent(3, 'closed', new Date(now - 8 * 86_400_000).toISOString()), sent(4, 'closed', null)], now)
    expect(out.map((i) => i.number)).toEqual([1, 2])
  })

  it("reads the last bot comment's first readable line, ignoring people and markup", () => {
    expect(lastBotLine([
      { user: { type: 'Bot' }, body: 'old bot line' },
      { user: { type: 'User' }, body: 'a person, later' },
      { user: { type: 'Bot' }, body: '<!-- sticky -->\n\n**Claude finished [@octo](https://github.com/octo)\'s task** in 2m\n- [x] Read the issue' },
    ])).toBe("Claude finished @octo's task in 2m")
    expect(lastBotLine([{ user: { type: 'Bot' }, body: '- [ ] Read the issue <img src=x onerror=alert(1)>' }])).toBe('Read the issue')
    expect(lastBotLine([{ user: { type: 'User' }, body: 'only people' }])).toBeNull()
    expect(lastBotLine([{ user: { type: 'Bot' }, body: 'x'.repeat(300) }])!.length).toBe(160)
    expect(lastBotLine('nope')).toBeNull()
  })

  it("links the last same-repo PR that references the issue, with its state; another repo's PR is ignored", () => {
    const xref = (n: number, url: string, state: string, merged: string | null) => ({ event: 'cross-referenced', source: { issue: { number: n, html_url: url, state, pull_request: { merged_at: merged } } } })
    expect(linkedPr('komogortev/planner', [
      xref(20, 'https://github.com/komogortev/planner/pull/20', 'closed', null),
      { event: 'labeled' },
      xref(21, 'https://github.com/komogortev/planner/pull/21', 'closed', NOW),
      xref(99, 'https://github.com/other/repo/pull/99', 'open', null),
      { event: 'cross-referenced', source: { issue: { number: 5, html_url: 'https://github.com/komogortev/planner/issues/5', state: 'open' } } }, // an issue, not a PR
    ])).toEqual({ number: 21, url: 'https://github.com/komogortev/planner/pull/21', state: 'merged' })
    expect(linkedPr('komogortev/planner', [xref(22, 'https://github.com/komogortev/planner/pull/22', 'open', null)])).toMatchObject({ state: 'open' })
    expect(linkedPr('komogortev/planner', [])).toBeNull()
  })

  it('spots the Claude Code Action in a workflow, and only as a `uses:` step', () => {
    expect(usesClaudeAction('on:\n  issues:\n    types: [opened]\njobs:\n  claude:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n')).toBe(true)
    expect(usesClaudeAction("on: [issue_comment]\n      - name: x\n        uses: 'anthropics/claude-code-action@beta'")).toBe(true)
    expect(usesClaudeAction('# we might add anthropics/claude-code-action@v1 later\n- uses: actions/checkout@v4')).toBe(false)
  })

  it('a body ends with the sign-off then the marker; the ask comes before the sign-off when chosen', () => {
    expect(issueBody('Steps', false, 'r')).toBe(`Steps\n\n${SIGN_OFF}\n\n<!-- planner:r -->`)
    expect(issueBody('', true, 'r')).toBe(`${CLAUDE_ASK}\n\n${SIGN_OFF}\n\n<!-- planner:r -->`)
  })
})

describe('C3 loop back: routes', () => {
  async function owner() {
    const a = await connected('a@example.com')
    await addProject(a.id, 'komogortev/planner')
    return a
  }
  const issue = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, title: `i${n}`, created_at: NOW, state: 'open', closed_at: null, comments: 0, html_url: `https://github.com/komogortev/planner/issues/${n}`, ...extra })

  it('each sent issue carries its bot line and linked PR; comments are read only when there are some', async () => {
    const a = await owner()
    const spy = github(file('docs/STATE.md', STATE), pulls([]), (u) => {
      if (u.pathname.endsWith('/planner/issues')) return Response.json([issue(8, { comments: 2 }), issue(7)])
      if (u.pathname.endsWith('/issues/8/comments')) return Response.json([{ user: { type: 'User' }, body: 'hi' }, { user: { type: 'Bot' }, body: 'Claude finished the task' }])
      if (u.pathname.endsWith('/issues/8/timeline')) return Response.json([{ event: 'cross-referenced', source: { issue: { number: 30, html_url: 'https://github.com/komogortev/planner/pull/30', state: 'open', pull_request: { merged_at: null } } } }])
      if (u.pathname.endsWith('/issues/7/timeline')) return Response.json([])
      return undefined
    })
    const out = (await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as { issues: unknown[] }
    expect(out.issues).toEqual([
      { number: 8, title: 'i8', createdAt: NOW, url: 'https://github.com/komogortev/planner/issues/8', state: 'open', closedAt: null, bot: 'Claude finished the task', pr: { number: 30, url: 'https://github.com/komogortev/planner/pull/30', state: 'open' } },
      { number: 7, title: 'i7', createdAt: NOW, url: 'https://github.com/komogortev/planner/issues/7', state: 'open', closedAt: null, bot: null, pr: null },
    ])
    expect(ghCalls(spy).filter((p) => p.endsWith('/comments'))).toEqual(['/repos/komogortev/planner/issues/8/comments'])
    expect(JSON.stringify(out)).not.toContain('"comments"')
  })

  it('claude: true with a Claude workflow, false without, null when GitHub will not list the folder', async () => {
    const a = await owner()
    const dir = (status = 200) => (u: URL) => (u.pathname.endsWith('/contents/.github/workflows')
      ? Response.json(status === 200 ? [{ type: 'file', name: 'ci.yml', path: '.github/workflows/ci.yml' }, { type: 'file', name: 'claude.yml', path: '.github/workflows/claude.yml' }] : {}, { status })
      : undefined)
    const ci = file('.github/workflows/ci.yml', '- uses: actions/checkout@v4')
    const claudeYml = file('.github/workflows/claude.yml', 'on:\n  issue_comment:\njobs:\n  c:\n    steps:\n      - uses: anthropics/claude-code-action@v1')
    github(dir(), ci, claudeYml)
    expect(((await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as { claude: unknown }).claude).toBe(true)
    vi.restoreAllMocks()
    github(dir(), ci)
    expect(((await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as { claude: unknown }).claude).toBe(false)
    vi.restoreAllMocks()
    github(dir(403))
    expect(((await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as { claude: unknown }).claude).toBeNull()
  })

  it('an older open issue still shows when 20 newer ones are closed: open and recently closed are read apart', async () => {
    const a = await owner()
    const spy = github(file('docs/STATE.md', STATE), pulls([]), (u) => {
      // closed just now on the real clock: the Worker's 7-day window is measured from Date.now(), so a fixed date goes stale
      if (!u.pathname.endsWith('/planner/issues')) return undefined
      return Response.json(u.searchParams.get('state') === 'open' ? [issue(3)] : [issue(9, { state: 'closed', closed_at: new Date().toISOString(), created_at: '2026-10-16T11:00:00.000Z' })])
    })
    const out = (await (await call(a.token, '/projects/state?repo=komogortev/planner')).json()) as { issues: { number: number }[] }
    expect(out.issues.map((i) => i.number)).toEqual([9, 3])
    const closed = spy.mock.calls.map(([u]) => new URL(String(u))).find((u) => u.pathname.endsWith('/planner/issues') && u.searchParams.get('state') === 'closed')!
    expect(closed.searchParams.get('since')).toBeTruthy()
  })

  it('a rate limit while reading the loop back degrades those parts instead of failing the card', async () => {
    const a = await owner()
    const limited = () => Response.json({ message: 'secondary rate limit' }, { status: 403, headers: { 'retry-after': '30' } })
    github(file('docs/STATE.md', STATE), pulls([]), (u) => {
      if (u.pathname.endsWith('/planner/issues')) return Response.json([issue(8, { comments: 1 })])
      if (u.pathname.includes('/issues/8/') || u.pathname.endsWith('/contents/.github/workflows')) return limited()
      return undefined
    })
    const res = await call(a.token, '/projects/state?repo=komogortev/planner')
    expect(res.status).toBe(200)
    const out = (await res.json()) as { snapshot: unknown; issues: { bot: unknown; pr: unknown }[]; claude: unknown }
    expect(out.snapshot).toMatchObject({ found: true })
    expect(out.issues[0]).toMatchObject({ bot: null, pr: null })
    expect(out.claude).toBeNull()
  })

  it("prefers Claude's comment over a later one from another bot", () => {
    expect(lastBotLine([
      { user: { type: 'Bot', login: 'claude[bot]' }, body: 'Claude finished the task' },
      { user: { type: 'Bot', login: 'vercel[bot]' }, body: 'Preview deployed' },
    ])).toBe('Claude finished the task')
    expect(lastBotLine([{ user: { type: 'Bot', login: 'github-actions[bot]' }, body: 'Working on it' }])).toBe('Working on it') // no Claude app: any bot
  })

  it('a review-only Claude workflow does not count: the issue trigger is needed', () => {
    expect(usesClaudeAction('on:\n  pull_request:\n    types: [opened]\njobs:\n  r:\n    steps:\n      - uses: anthropics/claude-code-action@v1')).toBe(false)
    expect(usesClaudeAction('on:\n  issues:\n    types: [opened]\njobs:\n  c:\n    steps:\n      - uses: anthropics/claude-code-action@v1')).toBe(true)
  })

  it("matches a PR link to the project whatever the repo name's case", () => {
    const ev = { event: 'cross-referenced', source: { issue: { number: 4, html_url: 'https://github.com/Komogortev/Planner/pull/4', state: 'open', pull_request: { merged_at: null } } } }
    expect(linkedPr('komogortev/planner', [ev])).toMatchObject({ number: 4 })
  })

  it('askClaude adds the ask line; a non-boolean is refused before GitHub', async () => {
    const a = await owner()
    let posted: Record<string, unknown> | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const u = new URL(String(input))
      if (u.pathname === '/user') return Response.json({ login: 'octo' })
      if (u.pathname.endsWith('/labels')) return Response.json({}, { status: 422 })
      if (u.pathname.endsWith('/issues') && init?.method === 'POST') { posted = JSON.parse(String(init.body)); return Response.json(issue(40), { status: 201 }) }
      if (u.pathname.endsWith('/issues')) return Response.json([])
      return Response.json({}, { status: 404 })
    })
    const body = (extra: Record<string, unknown>) => JSON.stringify({ repo: 'komogortev/planner', title: 'Do it', requestId: '0b6c3f0e-6a51-4d0c-9a3b-2f1e5d7c8a90', ...extra })
    expect((await call(a.token, '/projects/issue', { method: 'POST', body: body({ askClaude: 'yes' }) })).status).toBe(400)
    expect(posted).toBeNull()
    expect((await call(a.token, '/projects/issue', { method: 'POST', body: body({ askClaude: true }) })).status).toBe(201)
    expect(posted!.body).toBe(`${CLAUDE_ASK}\n\n${SIGN_OFF}\n\n<!-- planner:0b6c3f0e-6a51-4d0c-9a3b-2f1e5d7c8a90 -->`)
  })
})

describe('cutSnapshot', () => {
  it('cuts from the SNAPSHOT heading to the first --- or next heading; without one, the first 40 lines', () => {
    expect(cutSnapshot(STATE)).toEqual({ found: true, text: '- **Phase:** G2\n- **Working:** prod' })
    expect(cutSnapshot('## Snapshot\r\nline one\r\n## Next\nno')).toEqual({ found: true, text: 'line one' })
    const plain = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
    expect(cutSnapshot(plain)).toEqual({ found: false, text: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') })
    expect(cutSnapshot(`## SNAPSHOT\n${'x'.repeat(5000)}`).text.length).toBe(4001)
  })
})
