// GitHub bridge G2 — the repo list and a project's state (docs/GITHUB-BRIDGE.md §5–6). GitHub is stubbed by URL. Each
// refusal is paired with the same request succeeding for the owner, so "refused" cannot pass because nothing worked.
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/auth'
import { pushRecords } from '../src/records'
import { cutSnapshot, DEFAULT_CONFIG, parseConfig } from '../src/projects'
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
    ])
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
    expect(parseConfig('{"title":"P","state":"STATE.md","show":["merges"]}')).toEqual({ config: { title: 'P', state: 'STATE.md', show: ['merges'] }, error: null })
    expect(parseConfig('{"state":"../secrets","show":["issues"],"extra":1}')).toEqual({
      config: DEFAULT_CONFIG, error: '.planner.json: ignored state, show, extra',
    })
    for (const bad of ['/etc/passwd', 'a/../b', './x', 'a//b', 'x'.repeat(201)]) expect(parseConfig(JSON.stringify({ state: bad })).config.state, bad).toBe('docs/STATE.md')
    expect(parseConfig('not json')).toEqual({ config: DEFAULT_CONFIG, error: '.planner.json is not JSON' })
    expect(parseConfig('[]').error).toBe('.planner.json is not an object')
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
