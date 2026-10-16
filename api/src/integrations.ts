// /me/integrations — outside accounts a user connects by pasting a token (docs/GITHUB-BRIDGE.md §4, D-121). GitHub first.
// Same rules as /me/models (D-79): the token goes in once and never comes back out. Every response goes through
// `integrationView`, which carries the login, the last 4 characters and the expiry, nothing else of it. Tenant isolation
// as everywhere (A11): the user id comes from the session, every query binds it.
import { Hono } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import { KeyBoxUnavailable, openKey, sealKey } from './keyBox'
import type { Env } from './index'

export const GITHUB_API = 'https://api.github.com'
// The keyBox's middle slot. A colon never appears in a model id (MODEL_ID), so a model row's ciphertext can never be read
// back as an integration's, nor the reverse.
const SLOT = 'integration:github'
// Fine-grained tokens only: they are scoped to chosen repos and permissions (§4). A classic `ghp_` token reaches every repo.
export const GITHUB_TOKEN = /^github_pat_[A-Za-z0-9_]{20,255}$/
const GITHUB_TIMEOUT_MS = 10_000

export interface IntegrationRow {
  user_id: string; provider: string; key_ct: string; key_iv: string; key_hint: string; key_version: number
  login: string; expires_at: number | null; created_at: number; updated_at: number
}

/** The device's view of a connection: everything but the token. The one function every response goes through. */
export const integrationView = (r: IntegrationRow) => ({
  provider: r.provider, connected: true as const, login: r.login, keyHint: r.key_hint, expiresAt: r.expires_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
})

const getRow = (db: D1Database, userId: string) =>
  db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider = 'github'").bind(userId).first<IntegrationRow>()

/** Headers for every GitHub API call. GitHub refuses requests without a User-Agent. */
export const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'planner-api', 'X-GitHub-Api-Version': '2022-11-28',
})

/**
 * GitHub's token expiry header, e.g. `2026-11-15 12:00:00 UTC` or `2026-11-15 12:00:00 +0100`, as epoch ms. Null when the
 * header is absent (a token with no expiry) or unreadable: the card then shows no date rather than a wrong one.
 */
export function parseExpiry(header: string | null): number | null {
  const m = header?.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/)
  if (!m) return null
  const zone = m[3] === 'UTC' ? 'Z' : `${m[3]!.slice(0, 3)}:${m[3]!.slice(3)}`
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`)
  return Number.isFinite(t) ? t : null
}

/**
 * The stored token for a user, decrypted, or null when none is stored or it no longer decrypts. For the G2+ routes.
 * Throws `KeyBoxUnavailable` when MODEL_KEY_SECRET is missing or malformed: a caller answers 503 `not configured`, as PUT does.
 */
export async function githubToken(env: Env, userId: string): Promise<string | null> {
  const r = await getRow(env.DB, userId)
  return r ? openKey(env.MODEL_KEY_SECRET, r.key_ct, r.key_iv, userId, SLOT, GITHUB_API) : null
}

type Vars = { session: AuthedSession }
export const integrationsApi = new Hono<{ Bindings: Env; Variables: Vars }>()

integrationsApi.use('*', async (c, next) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
})

integrationsApi.get('/github', async (c) => {
  const r = await getRow(c.env.DB, c.get('session').id)
  return c.json(r ? integrationView(r) : { provider: 'github', connected: false })
})

// PUT /me/integrations/github { token } — connect, or replace the token. GitHub is asked whose token it is first; a token it
// refuses stores nothing.
integrationsApi.put('/github', async (c) => {
  const userId = c.get('session').id
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'not JSON' }, 400) }
  const raw = (body as { token?: unknown } | null)?.token
  const token = typeof raw === 'string' ? raw.trim() : ''
  if (!GITHUB_TOKEN.test(token)) {
    return c.json({
      error: token.startsWith('ghp_')
        ? 'Use a fine-grained token (it starts with github_pat_): a classic token reaches every repo.'
        : 'That is not a GitHub fine-grained token (it starts with github_pat_).',
    }, 400)
  }
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/user`, { headers: githubHeaders(token), redirect: 'manual', signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) })
  } catch {
    return c.json({ error: 'GitHub did not answer. Try again.' }, 502)
  }
  if (res.status === 401) return c.json({ error: 'GitHub rejected this token. Check it was copied whole and has not expired.' }, 400)
  if (!res.ok) return c.json({ error: `GitHub answered ${res.status}. Try again.` }, 502)
  const login = ((await res.json().catch(() => null)) as { login?: unknown } | null)?.login
  if (typeof login !== 'string' || login.length === 0 || login.length > 100) return c.json({ error: 'GitHub did not say whose token this is.' }, 502)
  const expiresAt = parseExpiry(res.headers.get('github-authentication-token-expiration'))

  let key: Awaited<ReturnType<typeof sealKey>>
  try {
    key = await sealKey(c.env.MODEL_KEY_SECRET, token, userId, SLOT, GITHUB_API)
  } catch (err) {
    if (err instanceof KeyBoxUnavailable) { console.error(`integrations: ${err.message}`); return c.json({ error: 'not configured' }, 503) }
    throw err
  }
  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO integrations (user_id, provider, key_ct, key_iv, key_hint, key_version, login, expires_at, created_at, updated_at)
     VALUES (?1, 'github', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT (user_id, provider) DO UPDATE SET key_ct = ?2, key_iv = ?3, key_hint = ?4, key_version = ?5, login = ?6,
       expires_at = ?7, updated_at = ?8`,
  ).bind(userId, key.ct, key.iv, key.hint, key.version, login, expiresAt, now).run()
  return c.json(integrationView((await getRow(c.env.DB, userId))!))
})

integrationsApi.delete('/github', async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM integrations WHERE user_id = ? AND provider = 'github'").bind(c.get('session').id).run()
  return c.json({ deleted: r.meta.changes > 0 })
})
