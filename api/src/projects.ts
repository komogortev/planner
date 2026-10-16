// GitHub bridge G2 (docs/GITHUB-BRIDGE.md §5–6): the repos a user's token reaches, and one project's state as GitHub holds
// it. Read-only. Every call uses the user's own stored token (integrations.ts) and the account from the session (A11);
// a repo's state is served only when the repo is one of the account's own project widgets.
//
// How a card looks is the repo's own `.planner.json` (§5, amendment 2026-10-16): `{ title?, state?, show?, brief?, issues? }`.
// C2 (§7, G4): POST /projects/issue sends one issue, only on the user's tap, labelled `planner`. Absent or
// unreadable → defaults, and the card says which. GitHub content is data: it is returned as text, never as markup.
import { Hono } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import { GITHUB_API, githubAccount, githubHeaders } from './integrations'
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
/** An issue kind the card's New issue sheet offers (C2): a name and the GitHub labels it adds besides `planner`. */
export interface IssueKind { name: string; labels: string[] }
/**
 * `brief`: the snapshot fields (their bold labels, e.g. "Next") the folded card shows, in order.
 * `issues`: the kinds the New issue sheet offers; empty = a plain title and body.
 */
export interface ProjectConfig { title: string | null; state: string; show: ShowPart[]; brief: string[]; issues: IssueKind[] }
export const DEFAULT_CONFIG: ProjectConfig = { title: null, state: 'docs/STATE.md', show: ['snapshot', 'merges'], brief: ['Next'], issues: [] }
const BRIEF_MAX = 4
const BRIEF_LABEL_MAX = 30
const KINDS_MAX = 8
const KIND_NAME_MAX = 24
const KIND_LABELS_MAX = 3
/** The label every issue the planner sends carries: how the card finds them again (GITHUB-BRIDGE §7). */
export const PLANNER_LABEL = 'planner'
/** A GitHub label name: up to 50 characters; no comma, since the issue-list filter splits on commas. */
const isLabel = (l: unknown): l is string => typeof l === 'string' && l.trim().length > 0 && l.trim().length <= 50 && !l.includes(',')

/** `issues` checked as a whole: any bad kind refuses the key (one typo must not silently drop one kind). */
function parseKinds(v: unknown): IssueKind[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > KINDS_MAX) return null
  const out: IssueKind[] = []
  const seen = new Set<string>()
  for (const k of v) {
    if (typeof k !== 'object' || k === null || Array.isArray(k)) return null
    const { name, labels, ...rest } = k as Record<string, unknown>
    if (Object.keys(rest).length > 0) return null
    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > KIND_NAME_MAX) return null
    if (seen.has(name.trim().toLowerCase())) return null
    seen.add(name.trim().toLowerCase())
    if (labels !== undefined && (!Array.isArray(labels) || labels.length > KIND_LABELS_MAX || !labels.every(isLabel))) return null
    out.push({ name: name.trim(), labels: ((labels as string[] | undefined) ?? []).map((l) => l.trim()) })
  }
  return out
}

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
  let brief = DEFAULT_CONFIG.brief
  if ('brief' in c) {
    const list = Array.isArray(c.brief) ? c.brief : null
    const ok = (l: unknown) => typeof l === 'string' && l.trim().length > 0 && l.trim().length <= BRIEF_LABEL_MAX
    if (list && list.length > 0 && list.length <= BRIEF_MAX && list.every(ok)) {
      // The card matches labels case-insensitively, so "Next" and "next" are one field: the first spelling is kept.
      const seen = new Set<string>()
      brief = (list as string[]).map((l) => l.trim()).filter((l) => !seen.has(l.toLowerCase()) && !!seen.add(l.toLowerCase()))
    }
    else ignored.push('brief')
  }
  let issues = DEFAULT_CONFIG.issues
  if ('issues' in c) {
    const kinds = parseKinds(c.issues)
    if (kinds) issues = kinds
    else ignored.push('issues')
  }
  for (const k of Object.keys(c)) if (!['title', 'state', 'show', 'brief', 'issues'].includes(k)) ignored.push(k)
  return { config: { title, state, show, brief, issues }, error: ignored.length ? `${CONFIG_PATH}: ignored ${ignored.join(', ')}` : null }
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
async function gh(token: string, path: string, accept?: string, post?: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      ...(post === undefined ? {} : { method: 'POST', body: JSON.stringify(post) }),
      headers: { ...githubHeaders(token), ...(accept ? { Accept: accept } : {}), ...(post === undefined ? {} : { 'Content-Type': 'application/json' }) },
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
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
  // A secondary limit (GitHub's abuse guard, easier to hit when creating) is a 403/429 carrying retry-after: a pause, not a
  // missing permission.
  if ((res.status === 403 || res.status === 429) && res.headers.get('retry-after') !== null) {
    throw new GithubRefused('GitHub is limiting requests for a moment. Try again in a minute.', 429)
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

/** The repo's `.planner.json`, read and checked; absent → the defaults. */
async function readConfig(token: string, repo: string): Promise<{ config: ProjectConfig; configSource: 'file' | 'default'; configError: string | null }> {
  const cfg = await gh(token, `/repos/${repoPath(repo)}/contents/${CONFIG_PATH}`, 'application/vnd.github.raw+json')
  if (cfg.ok) {
    const parsed = parseConfig((await boundedText(cfg)) ?? 'too large')
    return { config: parsed.config, configSource: 'file', configError: parsed.error }
  }
  return { config: DEFAULT_CONFIG, configSource: 'default', configError: cfg.status === 404 ? null : `${CONFIG_PATH}: GitHub answered ${cfg.status}` }
}

export const ISSUES_SHOWN = 5
/** How far back a retried send looks for its request id (newest first): far more than one person sends in a retry window. */
const DEDUPE_SCAN = 50
/**
 * An issue the planner sent. C3 adds the loop back: its state, the first line of the last bot comment (the Claude Action
 * reports in one comment it keeps editing), and the last pull request in this repo that references it.
 */
export interface SentIssue {
  number: number; title: string; url: string; createdAt: string; body?: string
  state: 'open' | 'closed'; closedAt: string | null; comments?: number
  bot?: string | null; pr?: { number: number; url: string; state: 'open' | 'closed' | 'merged' } | null
}
/** A closed sent issue stays on the card this long, then drops off (GITHUB-BRIDGE §8). */
export const CLOSED_SHOWN_MS = 7 * 86_400_000
/** Open ones, and closed ones from the last 7 days, newest first as GitHub listed them. */
export const recentSent = (list: SentIssue[], now: number) =>
  list.filter((i) => i.state === 'open' || (i.closedAt !== null && now - Date.parse(i.closedAt) <= CLOSED_SHOWN_MS))

const BOT_LINE_MAX = 160
/**
 * The first readable line of the last comment a bot wrote: markdown marks, links, HTML comments and checkbox prefixes
 * stripped. Null when no bot has commented. Text only: the card renders it as text.
 */
export function lastBotLine(comments: unknown): string | null {
  if (!Array.isArray(comments)) return null
  // Claude's own app comment first (another bot, e.g. a deploy preview, may comment later); any bot when there is none.
  const newest = [...(comments as Record<string, unknown>[])].reverse().filter((c) => (c.user as { type?: unknown } | null)?.type === 'Bot' && typeof c.body === 'string')
  const bot = newest.find((c) => (c.user as { login?: unknown }).login === 'claude[bot]') ?? newest[0]
  if (!bot) return null
  const line = (bot.body as string)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/^[\s>#*-]*(\[[ xX]\]\s*)?/, '').replace(/[*_`~]/g, '').trim())
    .find((l) => l.length > 0)
  if (!line) return null
  return line.length > BOT_LINE_MAX ? `${line.slice(0, BOT_LINE_MAX - 1).trimEnd()}…` : line
}

/** The last pull request in this same repo that the issue's timeline says references it. */
export function linkedPr(repo: string, timeline: unknown): SentIssue['pr'] {
  if (!Array.isArray(timeline)) return null
  let out: SentIssue['pr'] = null
  for (const e of timeline as Record<string, unknown>[]) {
    if (e.event !== 'cross-referenced') continue
    const src = (e.source as { issue?: Record<string, unknown> } | null)?.issue
    const pr = src?.pull_request as { merged_at?: unknown } | undefined
    if (!src || !pr || typeof src.number !== 'number' || typeof src.html_url !== 'string') continue
    // Another repo's PR is not this project's loop. GitHub names are case-insensitive.
    if (!src.html_url.toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/pull/`)) continue
    out = { number: src.number, url: src.html_url, state: typeof pr.merged_at === 'string' ? 'merged' : src.state === 'closed' ? 'closed' : 'open' }
  }
  return out
}

/** Whether a workflow file runs the Claude Code Action (GITHUB-BRIDGE §7: the `@claude` toggle shows only then). */
// A review-only workflow (triggered on pull_request) runs the action too, but never answers an issue: an issue trigger is
// required as well.
export const usesClaudeAction = (yaml: string) =>
  /^\s*-?\s*uses:\s*['"]?anthropics\/claude-code-action@/m.test(yaml) && /\bissues\s*:|\bissue_comment\b|\bissues\b\s*[\],]/.test(yaml)
const WORKFLOWS_READ = 8
/** The issues list filtered to what the planner sent from this login. */
const sentIssuesQuery = (login: string, state: 'open' | 'closed' | 'all', perPage = 20, since?: string) =>
  new URLSearchParams({
    labels: PLANNER_LABEL, creator: login, state, sort: 'created', direction: 'desc', per_page: String(perPage), ...(since ? { since } : {}),
  }).toString()

/**
 * A decoration read (bot line, PR, workflow detection) that a rate limit must not turn into a failed card: the snapshot
 * and merges already read still show. A 401 or a moved repo stays fatal.
 */
async function softly<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (err instanceof GithubRefused && err.status === 429) return fallback
    throw err
  }
}
/** GitHub's issue list as SentIssues: pull requests (which the issues API also lists) and malformed rows dropped. */
function toSentIssues(repo: string, list: unknown, keepBody = false): SentIssue[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, unknown>[])
    .filter((i) => !('pull_request' in i) && typeof i.number === 'number' && typeof i.title === 'string' && typeof i.created_at === 'string')
    .map((i) => ({
      number: i.number as number, title: (i.title as string).slice(0, 200), createdAt: i.created_at as string,
      url: typeof i.html_url === 'string' && i.html_url.startsWith('https://github.com/') ? i.html_url : `https://github.com/${repo}/issues/${i.number}`,
      state: i.state === 'closed' ? 'closed' as const : 'open' as const,
      closedAt: typeof i.closed_at === 'string' ? i.closed_at : null,
      ...(keepBody ? { body: typeof i.body === 'string' ? i.body : '' } : {}),
      ...(typeof i.comments === 'number' ? { comments: i.comments } : {}),
    }))
}

/** One sent issue with its loop back read: the bot's last line (only when it has comments) and the linked PR. */
async function withLoopBack(token: string, repo: string, i: SentIssue): Promise<SentIssue> {
  const r = repoPath(repo)
  let bot: string | null = null
  const n = i.comments ?? 0
  if (n > 0) {
    // Comments come oldest first: the last page holds the newest.
    const res = await gh(token, `/repos/${r}/issues/${i.number}/comments?per_page=100&page=${Math.ceil(n / 100)}`)
    if (res.ok) bot = lastBotLine(await res.json().catch(() => []))
  }
  const tl = await gh(token, `/repos/${r}/issues/${i.number}/timeline?per_page=100`)
  const pr = tl.ok ? linkedPr(repo, await tl.json().catch(() => [])) : null
  const { comments: _c, ...rest } = i
  return { ...rest, bot, pr }
}

/** Whether the repo has a workflow running the Claude Code Action; null when GitHub would not say. */
async function claudeWorkflow(token: string, repo: string): Promise<boolean | null> {
  const r = repoPath(repo)
  const dir = await gh(token, `/repos/${r}/contents/.github/workflows`)
  if (dir.status === 404) return false
  if (!dir.ok) return null
  const list = (await dir.json().catch(() => null)) as { name?: unknown; path?: unknown; type?: unknown }[] | null
  if (!Array.isArray(list)) return null
  const files = list
    .filter((f) => f.type === 'file' && typeof f.path === 'string' && typeof f.name === 'string' && /\.ya?ml$/i.test(f.name) && safePath(f.path))
    .slice(0, WORKFLOWS_READ)
  for (const f of files) {
    const res = await gh(token, `/repos/${r}/contents/${filePath(f.path as string)}`, 'application/vnd.github.raw+json')
    const text = res.ok ? await boundedText(res) : null
    if (text && usesClaudeAction(text)) return true
  }
  return false
}
/** The line that asks the Claude Code Action to work on an issue (its default trigger: `@claude` in a new issue's body). */
export const CLAUDE_ASK = '@claude please work on this issue.'
/** The visible sign-off on every sent issue, so a reader sees where it came from (owner, 2026-10-16). */
export const SIGN_OFF = '_Sent from [koplanner](https://koplanner.pages.dev/)_'
/** A sent issue's body: the user's text, the ask when chosen, the sign-off, and the request marker last. */
export const issueBody = (text: string, askClaude: boolean, requestId: string) =>
  [text, askClaude ? CLAUDE_ASK : '', SIGN_OFF, requestMarker(requestId)].filter((p) => p.length > 0).join('\n\n')
/** The marker a sent issue's body ends with: a retried send finds it and answers with that issue instead of a second one. */
export const requestMarker = (id: string) => `<!-- planner:${id} -->`
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const ISSUE_TITLE_MAX = 200
export const ISSUE_BODY_MAX = 10_000

type Vars = { session: AuthedSession }

/** The user's token and GitHub login, or a ready response saying why there is none. */
async function accountOr(c: { env: Env; get: (k: 'session') => AuthedSession; json: (b: unknown, s: number) => Response }): Promise<{ token: string; login: string } | Response> {
  try {
    const t = await githubAccount(c.env, c.get('session').id)
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
  const account = await accountOr(c)
  if (account instanceof Response) return account
  const { token } = account
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
  const account = await accountOr(c)
  if (account instanceof Response) return account
  const { token, login } = account
  try {
    // 1. The repo's own card config.
    const { config, configSource, configError } = await readConfig(token, repo)
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
    // 4. The issues the planner sent from this login (C2): open ones and those closed in the last 7 days, each with its
    //    loop back (C3): the bot's last line and the linked pull request.
    //    Open and recently closed are read apart, so many newer closed issues can't push an older open one off the page.
    let issues: SentIssue[] | { error: string } = []
    const now = Date.now()
    const open = await gh(token, `/repos/${repoPath(repo)}/issues?${sentIssuesQuery(login, 'open')}`)
    if (open.ok) {
      const since = new Date(now - CLOSED_SHOWN_MS).toISOString()
      const closed = await softly(() => gh(token, `/repos/${repoPath(repo)}/issues?${sentIssuesQuery(login, 'closed', 20, since)}`), null)
      const all = [...toSentIssues(repo, await open.json().catch(() => [])), ...(closed?.ok ? toSentIssues(repo, await closed.json().catch(() => [])) : [])]
        .filter((i, at, list) => list.findIndex((x) => x.number === i.number) === at) // reopened between the reads: once
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const shown = recentSent(all, now).slice(0, ISSUES_SHOWN)
      issues = []
      for (const i of shown) {
        const { comments: _c, ...plain } = i
        issues.push(await softly(() => withLoopBack(token, repo, i), { ...plain, bot: null, pr: null }))
      }
    } else {
      issues = { error: `GitHub answered ${open.status} for the issues` }
    }
    // 5. Whether the repo runs the Claude Code Action: the New issue sheet offers "Ask Claude" only then (C3).
    const claude = await softly(() => claudeWorkflow(token, repo), null)
    return c.json({ repo, config, configSource, configError, snapshot, merges, issues, claude, fetchedAt: Date.now() })
  } catch (err) {
    if (err instanceof GithubRefused) return c.json({ error: err.message }, err.status as 409)
    throw err
  }
})

// ── POST /projects/issue { repo, title, body?, kind?, requestId, askClaude? } ─────────────────────────────────────────────────
// Sends one issue to one of the account's projects (C2, GITHUB-BRIDGE §7). Only this route writes to GitHub, and only the
// user's Send tap calls it. Order: input → ownership (404 before any GitHub call) → the repo's kinds → an earlier send of
// the same request (a retry after a lost answer gets that issue back) → labels → the issue.
// "No issue was sent", not "nothing": a label made just before a refused create stays in the repo.
const sendRefusal = (status: number) =>
  status === 403 ? 'GitHub refused: the token needs Issues: Read and write on this repo. Edit the token on GitHub. No issue was sent.'
    : status === 404 ? 'GitHub cannot see this repo with the stored token. No issue was sent.'
      : status === 410 ? 'Issues are turned off for this repo. No issue was sent.'
        : `GitHub answered ${status}. No issue was sent.`
/** A 5xx on the create itself may come after GitHub wrote the issue: the retry (same request id) finds it, never doubles it. */
const createUnsure = (status: number) => `GitHub answered ${status}. It may have been sent: Send again checks rather than sending twice.`

projectsApi.post('/issue', async (c) => {
  let input: Record<string, unknown> | null = null
  try { input = (await c.req.json()) as Record<string, unknown> } catch { /* answered below */ }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return c.json({ error: 'not JSON' }, 400)
  const { repo, title, body, kind, requestId, askClaude } = input
  if (!isRepoFullName(repo)) return c.json({ error: 'repo: owner/name' }, 400)
  if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > ISSUE_TITLE_MAX) return c.json({ error: `title: 1–${ISSUE_TITLE_MAX} characters` }, 400)
  if (body !== undefined && (typeof body !== 'string' || body.length > ISSUE_BODY_MAX)) return c.json({ error: `body: up to ${ISSUE_BODY_MAX} characters` }, 400)
  if (kind !== undefined && kind !== null && typeof kind !== 'string') return c.json({ error: 'kind: a name or null' }, 400)
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return c.json({ error: 'requestId: a uuid' }, 400)
  if (askClaude !== undefined && typeof askClaude !== 'boolean') return c.json({ error: 'askClaude: true or false' }, 400)
  if (!(await ownsProject(c.env.DB, c.get('session').id, repo))) return c.json({ error: 'not a project of yours' }, 404)
  const account = await accountOr(c)
  if (account instanceof Response) return account
  const { token, login } = account
  const r = repoPath(repo)
  try {
    let labels = [PLANNER_LABEL]
    if (typeof kind === 'string') {
      const { config } = await readConfig(token, repo)
      const k = config.issues.find((x) => x.name.toLowerCase() === kind.trim().toLowerCase())
      if (!k) return c.json({ error: `"${kind.slice(0, 40)}" is not an issue kind in ${CONFIG_PATH}. Refresh the card. Nothing was sent.` }, 409)
      labels = [...new Set([PLANNER_LABEL, ...k.labels])]
    }
    // An earlier send of this request: when this check cannot run, nothing is sent (a blind create could duplicate).
    const prior = await gh(token, `/repos/${r}/issues?${sentIssuesQuery(login, 'all', DEDUPE_SCAN)}`)
    if (!prior.ok) return c.json({ error: sendRefusal(prior.status) }, prior.status === 403 || prior.status === 404 || prior.status === 410 ? 409 : 502)
    const hit = toSentIssues(repo, await prior.json().catch(() => []), true).find((i) => i.body?.includes(requestMarker(requestId)))
    if (hit) { const { body: _b, ...issue } = hit; return c.json({ issue, created: false }) }
    // Labels: 201 made it, 422 means it is there already.
    for (const name of labels) {
      const res = await gh(token, `/repos/${r}/labels`, undefined, { name })
      if (res.status !== 201 && res.status !== 422) return c.json({ error: sendRefusal(res.status) }, res.status === 403 || res.status === 404 ? 409 : 502)
    }
    const text = typeof body === 'string' ? body.trim() : ''
    const res = await gh(token, `/repos/${r}/issues`, undefined, {
      title: title.trim(), body: issueBody(text, askClaude === true, requestId), labels,
    })
    if (res.status >= 500) return c.json({ error: createUnsure(res.status) }, 502)
    if (res.status !== 201) return c.json({ error: sendRefusal(res.status) }, res.status === 403 || res.status === 404 || res.status === 410 ? 409 : 502)
    const [issue] = toSentIssues(repo, [await res.json().catch(() => null)])
    if (!issue) return c.json({ error: 'GitHub made the issue but sent no details. Refresh the card to see it.' }, 502)
    return c.json({ issue, created: true }, 201)
  } catch (err) {
    // A timeout may hide a created issue: the message says "Try again", and the retry finds it by its request id.
    if (err instanceof GithubRefused) return c.json({ error: err.message }, err.status as 409)
    throw err
  }
})
