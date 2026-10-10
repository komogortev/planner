// GitHub + Google sign-in → opaque bearer token. Plain fetch + Web Crypto, adapted from the 0BSD
// examples Arctic's maintainer published when deprecating it (github.com/pilcrowonpaper/arctic/tree/main/code).
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { appUrls } from './config'
import type { Env } from './index'

type Provider = 'github' | 'google'
// `emails`: every verified address the provider vouches for, primary first. A new account takes the first invited one.
type Identity = { providerUserId: string; emails: string[]; name: string | null }
type C = Context<{ Bindings: Env }>

const SESSION_DAYS = 30
const FLOW_COOKIE = 'oauth_flow'
// base64url, as the app generates it; bounded so it cannot bloat the flow cookie.
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/

const PROVIDERS = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    pkce: false,
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
  },
} as const

// ── encoding helpers ────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

function credentials(env: Env, p: Provider) {
  return p === 'github'
    ? { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET }
    : { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
}

function redirectUri(c: C, p: Provider): string {
  return `${new URL(c.req.url).origin}/auth/callback/${p}`
}

function isProvider(p: string): p is Provider {
  return p === 'github' || p === 'google'
}

// ── identity fetch per provider ─────────────────────────────────────────────

async function githubIdentity(accessToken: string): Promise<Identity | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'planner-api', Accept: 'application/vnd.github+json' }
  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/emails', { headers }),
  ])
  if (!userRes.ok || !emailsRes.ok) return null
  const user = (await userRes.json()) as { id: number; name: string | null; login: string }
  const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[]
  // Primary first, so it wins when several verified addresses are allowlisted.
  const verified = emails.filter((e) => e.verified).sort((a, b) => Number(b.primary) - Number(a.primary))
  if (verified.length === 0) return null
  return { providerUserId: String(user.id), emails: verified.map((e) => e.email.toLowerCase()), name: user.name ?? user.login }
}

// The ID token comes straight from Google's token endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place of
// a signature check. The claims are still checked.
function googleIdentity(idToken: string, clientId: string): Identity | null {
  const part = idToken.split('.')[1]
  if (!part) return null
  // atob yields one char per byte; decode those bytes as UTF-8 or non-Latin names arrive garbled.
  const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
    iss: string; aud: string; exp: number; sub: string; email?: string; email_verified?: boolean; name?: string
  }
  const issOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com'
  if (!issOk || claims.aud !== clientId || claims.exp * 1000 < Date.now()) return null
  if (!claims.email || claims.email_verified !== true) return null
  return { providerUserId: claims.sub, emails: [claims.email.toLowerCase()], name: claims.name ?? null }
}

// ── account + session writes ────────────────────────────────────────────────

type UserRow = { id: string; email: string; disabled_at: number | null }

/**
 * Who may sign in, in order: an identity already linked to an account; an existing account with one of the verified
 * emails (this provider gets linked to it); a new account, only through an open invite for a verified email.
 * Returns the account id, or null when the caller is not invited or the account is disabled (revoked).
 */
async function admit(db: D1Database, p: Provider, who: Identity): Promise<string | null> {
  const linked = await db
    .prepare('SELECT u.id, u.email, u.disabled_at FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.provider_user_id = ?')
    .bind(p, who.providerUserId)
    .first<UserRow>()
  if (linked) return linked.disabled_at === null ? linked.id : null

  // Same verified email from another provider → same account. Primary email first (who.emails is ordered).
  const marks = who.emails.map(() => '?').join(', ')
  const { results } = await db.prepare(`SELECT id, email, disabled_at FROM users WHERE email IN (${marks})`).bind(...who.emails).all<UserRow>()
  const existing = who.emails.map((e) => results.find((u) => u.email === e)).find(Boolean)
  if (existing) {
    if (existing.disabled_at !== null) return null
    // OR IGNORE: two first sign-ins with the same new identity (a double-clicked tab) would otherwise 500 on the PK.
    await db.prepare('INSERT OR IGNORE INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)').bind(p, who.providerUserId, existing.id).run()
    return existing.id
  }

  // New account. One batch (one transaction) per candidate email: every write is conditional on an open invite, so a
  // missing, expired or already-used invite writes nothing, and of two racing sign-ins only the first creates the user.
  const now = Date.now()
  for (const email of who.emails) {
    const userId = crypto.randomUUID()
    const open = 'SELECT 1 FROM invites WHERE email = ? AND used_by IS NULL AND expires_at > ?'
    const [created] = await db.batch([
      db.prepare(`INSERT INTO users (id, email, name, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (${open})`)
        .bind(userId, email, who.name, now, email, now),
      db.prepare('INSERT INTO identities (provider, provider_user_id, user_id) SELECT ?, ?, id FROM users WHERE id = ?')
        .bind(p, who.providerUserId, userId),
      db.prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE email = ? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?)`)
        .bind(userId, now, email, userId),
    ])
    if (created.meta.changes === 1) return userId
  }
  return null
}

/** A new session for the account; its expired sessions are purged on the way (no cron needed for one user's rows). */
export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = randomToken()
  const now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(userId, now),
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), userId, now, now + SESSION_DAYS * 86_400_000),
  ])
  return token
}

const bearerOf = (header: string | undefined): string | null => header?.match(/^Bearer (.+)$/)?.[1] ?? null
const bearer = (c: C): string | null => bearerOf(c.req.header('Authorization'))

export type AuthedSession = { id: string; email: string; name: string | null; tokenHash: string; expiresAt: number }

/** The signed-in account and its session for an `Authorization: Bearer <token>` header, or null. */
export async function authenticate(db: D1Database, authorization: string | undefined): Promise<AuthedSession | null> {
  const token = bearerOf(authorization)
  if (!token) return null
  const tokenHash = await sha256(token)
  // A disabled (revoked) account is signed out everywhere at once, even if a session row survived.
  const row = await db.prepare(
    `SELECT u.id, u.email, u.name, s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
  )
    .bind(tokenHash, Date.now())
    .first<{ id: string; email: string; name: string | null; expiresAt: number }>()
  return row ? { ...row, tokenHash } : null
}

/** The signed-in user for a request's `Authorization: Bearer <token>`, or null. */
export async function sessionUser(c: C): Promise<{ id: string; email: string; name: string | null } | null> {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  return s ? { id: s.id, email: s.email, name: s.name } : null
}

// A sync that succeeds pushes the session out to a full 30 days (H1 §8) — but at most once a day, so a 60 s sync loop
// costs one D1 write a day, not 1,440.
const RENEW_AFTER_MS = 86_400_000

export async function renewSession(db: D1Database, s: AuthedSession): Promise<void> {
  const now = Date.now()
  if (s.expiresAt - now > SESSION_DAYS * 86_400_000 - RENEW_AFTER_MS) return
  await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_DAYS * 86_400_000, s.tokenHash).run()
}

// ── routes ──────────────────────────────────────────────────────────────────

export const auth = new Hono<{ Bindings: Env }>()

// GET /auth/start/:provider?return_to=<app URL>&nonce=<app-held random> — the app navigates here (top-level, not fetch).
// The nonce comes back in the fragment next to the token; the app rejects a token whose nonce it did not issue, so
// nobody can sign the app into *their* account by sending it a crafted `#token=` link (login CSRF).
auth.get('/start/:provider', async (c) => {
  const p = c.req.param('provider')
  if (!isProvider(p)) return c.text('unknown provider', 404)

  let returnTo = ''
  try { returnTo = new URL(c.req.query('return_to') ?? '').href } catch { /* invalid → rejected below */ }
  // Length-capped too: an oversized flow cookie is dropped silently and the callback reports "expired".
  if (returnTo.length > 512 || !appUrls(c.env).some((u) => returnTo.startsWith(u))) return c.text('return_to not allowed', 400)
  const nonce = c.req.query('nonce') ?? ''
  if (!NONCE_RE.test(nonce)) return c.text('nonce missing or malformed', 400)

  const cfg = PROVIDERS[p]
  const state = randomToken()
  const verifier = cfg.pkce ? randomToken() : ''
  const url = new URL(cfg.authorize)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', credentials(c.env, p).id)
  url.searchParams.set('redirect_uri', redirectUri(c, p))
  url.searchParams.set('scope', cfg.scope)
  url.searchParams.set('state', state)
  if (cfg.pkce) {
    url.searchParams.set('code_challenge', await sha256(verifier))
    url.searchParams.set('code_challenge_method', 'S256')
  }

  // The API's own origin (workers.dev is on the public suffix list), so no other site can plant this cookie.
  setCookie(c, FLOW_COOKIE, JSON.stringify({ p, state, verifier, returnTo, nonce }), {
    path: '/auth', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600,
  })
  return c.redirect(url.toString())
})

// GET /auth/callback/:provider?code&state — the provider redirects here.
auth.get('/callback/:provider', async (c) => {
  const p = c.req.param('provider')
  if (!isProvider(p)) return c.text('unknown provider', 404)

  const raw = getCookie(c, FLOW_COOKIE)
  deleteCookie(c, FLOW_COOKIE, { path: '/auth', secure: true })
  let flow: { p: string; state: string; verifier: string; returnTo: string; nonce: string } | null = null
  try { flow = raw ? JSON.parse(raw) : null } catch { /* tampered → treated as expired */ }
  const code = c.req.query('code')
  if (!flow || flow.p !== p || typeof flow.returnTo !== 'string' || typeof flow.nonce !== 'string' || !code || c.req.query('state') !== flow.state) {
    return c.text('sign-in expired, start again', 400)
  }

  const cred = credentials(c.env, p)
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(c, p), client_id: cred.id, client_secret: cred.secret })
  if (flow.verifier) body.set('code_verifier', flow.verifier)
  const tokenRes = await fetch(PROVIDERS[p].token, { method: 'POST', body, headers: { Accept: 'application/json' } })
  // GitHub answers a bad or expired code with 200 + {error}, so check both.
  const tokens = tokenRes.ok ? ((await tokenRes.json()) as { access_token?: string; id_token?: string; error?: string }) : null
  if (!tokens || tokens.error) return c.text('provider refused the code', 502)

  const who = p === 'github'
    ? tokens.access_token ? await githubIdentity(tokens.access_token) : null
    : tokens.id_token ? googleIdentity(tokens.id_token, cred.id) : null
  if (!who) return c.text('no verified email from provider', 403)

  const userId = await admit(c.env.DB, p, who)
  // Shown only to whoever just proved they own these addresses — it names nothing they don't already know.
  if (!userId) return c.text(`not invited — ${p} reported: ${who.emails.join(', ')}`, 403)

  const token = await createSession(c.env.DB, userId)
  // Fragment, not query: never sent to a server or written to access logs. Set via URL so a `#` already in
  // return_to is replaced, not appended to.
  const back = new URL(flow.returnTo)
  back.hash = new URLSearchParams({ token, nonce: flow.nonce }).toString()
  return c.redirect(back.href)
})

// POST /auth/logout — ends the calling session on the server (the app also forgets the token). Idempotent.
auth.post('/logout', async (c) => {
  const token = bearer(c)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  return c.body(null, 204)
})
