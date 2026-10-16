// GitHub bridge G2 (docs/GITHUB-BRIDGE.md §5–6): the repos a user's token reaches, and one project's state as GitHub holds
// it. Read-only. Every call uses the user's own stored token (integrations.ts) and the account from the session (A11);
// a repo's state is served only when the repo is one of the account's own project widgets.
//
// How a card looks is the repo's own `.planner.json` (§5, amendment 2026-10-16): `{ title?, state?, show? }`. Absent or
// unreadable → defaults, and the card says which. GitHub content is data: it is returned as text, never as markup.
import { Hono } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import { GITHUB_API, githubHeaders, githubToken } from './integrations'
import { KeyBoxUnavailable } from './keyBox'
import { isRepoFullName } from '../../src/domain/records'
import type { Env } from './index'

const TIMEOUT_MS = 10_000
const REPO_PAGES = 3 // 300 repos: more than a fine-grained token with "only select repositories" reaches
export const SNAPSHOT_MAX_CHARS = 4_000
export const MERGES_SHOWN = 5
export const CONFIG_PATH = '.planner.json'
export const SHOW_PARTS = ['snapshot', 'merges'] as const
export type ShowPart = (typeof SHOW_PARTS)[number]
export interface ProjectConfig { title: string | null; state: string; show: ShowPart[] }
export const DEFAULT_CONFIG: ProjectConfig = { title: null, state: 'docs/STATE.md', show: ['snapshot', 'merges'] }

/** A repo-relative file path: segments of safe characters, no `..`, no leading slash. */
const SAFE_PATH = /^(?!\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/
const safePath = (p: unknown): p is string => typeof p === 'string' && p.length <= 200 && SAFE_PATH.test(p) && !p.split('/').some((s) => s === '..' || s === '.')

/**
 * The repo's `.planner.json`, checked. Each key falls back to its default on its own; `error` names what was ignored, so a
 * typo shows on the card instead of silently doing nothing.
 */
export function parseConfig(raw: string): { config: ProjectConfig; error: string | null } {
  let o: unknown
  try { o = JSON.parse(raw) } catch { return { config: DEFAULT_CONFIG, error: `${CONFIG_PATH} is not JSON` } }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { config: DEFAULT_CONFIG, error: `${CONFIG_PATH} is not an object` }
  const c = o as Record<string, unknown>
  const ignored: string[] = []
  let title = DEFAULT_CONFIG.title
  if ('title' in c) {
    if (typeof c.title === 'string' && c.title.trim().length > 0 && c.title.length <= 80) title = c.title.trim()
    else ignored.push('title')
  }
  let state = DEFAULT_CONFIG.state
  if ('state' in c) {
    if (safePath(c.state)) state = c.state
    else ignored.push('state')
  }
  let show = DEFAULT_CONFIG.show
  if ('show' in c) {
    const list = Array.isArray(c.show) ? c.show : null
    if (list && list.length > 0 && list.every((p) => (SHOW_PARTS as readonly unknown[]).includes(p))) show = [...new Set(list as ShowPart[])]
    else ignored.push('show')
  }
  for (const k of Object.keys(c)) if (!['title', 'state', 'show'].includes(k)) ignored.push(k)
  return { config: { title, state, show }, error: ignored.length ? `${CONFIG_PATH}: ignored ${ignored.join(', ')}` : null }
}

/**
 * The snapshot section of a STATE file: from a `## SNAPSHOT` heading to the first `---` line or the next `## ` heading,
 * trimmed and capped. No heading: the first 40 lines, marked `found: false` so the card can say so.
 */
export function cutSnapshot(text: string): { found: boolean; text: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^##\s+snapshot\b/i.test(l.trim()))
  let body: string[]
  if (at === -1) body = lines.slice(0, 40)
  else {
    body = []
    for (const l of lines.slice(at + 1)) {
      if (l.trim() === '---' || /^##\s/.test(l)) break
      body.push(l)
    }
  }
  let out = body.join('\n').trim()
  if (out.length > SNAPSHOT_MAX_CHARS) out = `${out.slice(0, SNAPSHOT_MAX_CHARS).trimEnd()}…`
  return { found: at !== -1, text: out }
}

class GithubRefused extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** One GitHub API call. 401 and rate limits end the whole read (thrown); any other status is the caller's to judge. */
async function gh(token: string, path: string, accept?: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers: { ...githubHeaders(token), ...(accept ? { Accept: accept } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new GithubRefused('GitHub did not answer. Try again.', 502)
  }
  if (res.status === 301 || res.status === 302 || res.status === 307) throw new GithubRefused('This repo was renamed or moved on GitHub. Switch it on again under its new name.', 409)
  if (res.status === 401) throw new GithubRefused('GitHub refused the stored token. Reconnect GitHub in Settings → Integrations.', 409)
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString().slice(11, 16) : null
    throw new GithubRefused(`GitHub's limit is reached${at ? `; try again after ${at} UTC` : ''}.`, 429)
  }
  return res
}

/** A file body, refused above 1 MB: a `state` path pointing at a large file must not make the Worker buffer all of it. */
const FILE_MAX_BYTES = 1_000_000
async function boundedText(res: Response): Promise<string | null> {
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > FILE_MAX_BYTES) return null
  const text = await res.text()
  return text.length > FILE_MAX_BYTES ? null : text
}

const repoPath = (repo: string) => repo.split('/').map(encodeURIComponent).join('/')
const filePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

type Vars = { session: AuthedSession }

/** The user's token, or a ready response saying why there is none. */
async function tokenOr(c: { env: Env; get: (k: 'session') => AuthedSession; json: (b: unknown, s: number) => Response }): Promise<string | Response> {
  try {
    const t = await githubToken(c.env, c.get('session').id)
    return t ?? c.json({ error: 'GitHub is not connected. Connect it in Settings → Integrations.' }, 409)
  } catch (err) {
    if (err instanceof KeyBoxUnavailable) { console.error(`projects: ${err.message}`); return c.json({ error: 'not configured' }, 503) }
    throw err
  }
}

const authed = async (c: any, next: () => Promise<void>) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
}

// ── GET /me/integrations/github/repos ─────────────────────────────────────────────────────────────────────────────
export const reposApi = new Hono<{ Bindings: Env; Variables: Vars }>()
reposApi.use('*', authed)
reposApi.get('/', async (c) => {
  const token = await tokenOr(c)
  if (token instanceof Response) return token
  const repos: { fullName: string; private: boolean; pushedAt: string | null }[] = []
  try {
    for (let page = 1; page <= REPO_PAGES; page++) {
      const res = await gh(token, `/user/repos?per_page=100&sort=pushed&page=${page}`)
      if (!res.ok) return c.json({ error: `GitHub answered ${res.status} for the repo list.` }, 502)
      const list = (await res.json().catch(() => null)) as { full_name?: unknown; private?: unknown; pushed_at?: unknown }[] | null
      if (!Array.isArray(list)) return c.json({ error: 'GitHub sent no repo list.' }, 502)
      for (const r of list) {
        if (isRepoFullName(r.full_name)) {
          repos.push({ fullName: r.full_name, private: r.private === true, pushedAt: typeof r.pushed_at === 'string' ? r.pushed_at : null })
        }
      }
      if (list.length < 100) break
    }
  } catch (err) {
    if (err instanceof GithubRefused) return c.json({ error: err.message }, err.status as 409)
    throw err
  }
  return c.json({ repos })
})

// ── GET /projects/state?repo=owner/name ───────────────────────────────────────────────────────────────────────────
export const projectsApi = new Hono<{ Bindings: Env; Variables: Vars }>()
projectsApi.use('*', authed)

/** Whether `repo` is one of this account's project widgets (live). GitHub names are case-insensitive. */
async function ownsProject(db: D1Database, userId: string, repo: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS hit FROM records WHERE user_id = ? AND kind = 'widget' AND deleted_at IS NULL
       AND json_extract(data, '$.kind') = 'project' AND lower(json_extract(data, '$.project.repo')) = lower(?)`,
  ).bind(userId, repo).first()
  return row !== null
}

projectsApi.get('/state', async (c) => {
  const repo = c.req.query('repo') ?? ''
  if (!isRepoFullName(repo)) return c.json({ error: 'repo: owner/name' }, 400)
  // The same answer for "not yours" and "no such project": the route never confirms what another account holds.
  if (!(await ownsProject(c.env.DB, c.get('session').id, repo))) return c.json({ error: 'not a project of yours' }, 404)
  const token = await tokenOr(c)
  if (token instanceof Response) return token
  try {
    // 1. The repo's own card config.
    let config = DEFAULT_CONFIG
    let configSource: 'file' | 'default' = 'default'
    let configError: string | null = null
    const cfg = await gh(token, `/repos/${repoPath(repo)}/contents/${CONFIG_PATH}`, 'application/vnd.github.raw+json')
    if (cfg.ok) {
      const parsed = parseConfig((await boundedText(cfg)) ?? 'too large')
      config = parsed.config
      configError = parsed.error
      configSource = 'file'
    } else if (cfg.status !== 404) {
      configError = `${CONFIG_PATH}: GitHub answered ${cfg.status}`
    }
    // 2. The STATE snapshot.
    let snapshot: { found: boolean; text: string; path: string } | { error: string; path: string } | null = null
    if (config.show.includes('snapshot')) {
      const st = await gh(token, `/repos/${repoPath(repo)}/contents/${filePath(config.state)}`, 'application/vnd.github.raw+json')
      const body = st.ok ? await boundedText(st) : null
      if (st.ok && body === null) snapshot = { error: `${config.state} is over 1 MB`, path: config.state }
      else if (st.ok) snapshot = { ...cutSnapshot(body!), path: config.state }
      else snapshot = { error: st.status === 404 ? `No file at ${config.state}` : `GitHub answered ${st.status} for ${config.state}`, path: config.state }
    }
    // 3. The last merged pull requests.
    let merges: { number: number; title: string; mergedAt: string; url: string }[] | { error: string } | null = null
    if (config.show.includes('merges')) {
      const pr = await gh(token, `/repos/${repoPath(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)
      if (pr.ok) {
        const list = (await pr.json().catch(() => [])) as { number?: unknown; title?: unknown; merged_at?: unknown; html_url?: unknown }[]
        merges = (Array.isArray(list) ? list : [])
          .filter((p) => typeof p.merged_at === 'string' && typeof p.number === 'number' && typeof p.title === 'string')
          .sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)))
          .slice(0, MERGES_SHOWN)
          .map((p) => ({
            number: p.number as number, title: (p.title as string).slice(0, 200), mergedAt: p.merged_at as string,
            url: typeof p.html_url === 'string' && p.html_url.startsWith('https://github.com/') ? p.html_url : `https://github.com/${repo}/pull/${p.number}`,
          }))
      } else {
        merges = { error: `GitHub answered ${pr.status} for the pull requests` }
      }
    }
    return c.json({ repo, config, configSource, configError, snapshot, merges, fetchedAt: Date.now() })
  } catch (err) {
    if (err instanceof GithubRefused) return c.json({ error: err.message }, err.status as 409)
    throw err
  }
})
