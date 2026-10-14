// H1-S1 spike sign-in: the app half of the Worker's /auth flow (api/src/auth.ts).
// Kept for S3, which replaces the test screen with the real account UI.

// A parallel session's dev pair runs its own Worker on another port (RUNBOOK "Parallel sessions"): VITE_API_URL points the
// dev app at it. Development only; a production build always talks to the deployed Worker.
export const API_URL = import.meta.env.DEV
  ? ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787')
  : 'https://planner-api.komogortev.workers.dev'

export type Provider = 'github' | 'google'

// localStorage, not sessionStorage: sessionStorage is per browsing context, and an iOS home-screen app may come back
// from the provider in a new one. The spike must measure whether the *token* survives, not lose the nonce first.
const PENDING_KEY = 'planner.signIn.pending'
export const TOKEN_KEY = 'planner.signIn.token'
const RESULT_KEY = 'planner.signIn.lastResult'
const PENDING_TTL_MS = 10 * 60_000 // the Worker's flow cookie lives 10 minutes too

type Pending = { nonce: string; provider: Provider; at: number }
export type ReturnResult =
  | { ok: true; token: string; provider: Provider }
  | { ok: false; reason: string }

const PROVIDER_NAME = { github: 'GitHub', google: 'Google' } as const

/** A short list from a comma-separated fragment parameter: a few entries, none long. Rendered as text, never as markup. */
function listParam(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '' && s.length <= 120).slice(0, 3).join(', ')
}

/**
 * The wording of a refusal the Worker sent back (D-57). The code is one of a fixed list — anything else reads as a
 * generic refusal; the parameters are `p` (the provider) and the addresses it reported, which the person needs in order
 * to ask for an invite for the right one. The Worker's own text is never shown.
 */
export function refusalMessage(code: string | null, params: URLSearchParams, fallback: Provider): string {
  const asked = params.get('p')
  const who = PROVIDER_NAME[asked === 'github' || asked === 'google' ? asked : fallback]
  switch (code) {
    case 'expired': return 'The sign-in took too long or was interrupted — start again.'
    case 'cancelled': return 'The sign-in was cancelled — start again when you are ready.'
    case 'provider': return `${who} would not complete the sign-in — try again.`
    case 'no-verified-email': return `${who} gave no verified email address — verify one with ${who}, or sign in with the other provider.`
    case 'disabled': return 'This account has been disabled.'
    case 'server': return 'Something went wrong while signing in — try again in a moment.'
    case 'not-invited': {
      const unvouched = listParam(params, 'unvouched')
      if (unvouched) return `${who} cannot vouch for ${unvouched} — sign in with GitHub, or a Gmail or Google Workspace account.`
      const emails = listParam(params, 'emails')
      return emails ? `Not invited. ${who} reported ${emails} — ask for an invite for one of these addresses.` : 'Not invited — ask for an invite.'
    }
    default: return 'The sign-in was refused — try again.'
  }
}

/**
 * Decide whether a `#token=…&nonce=…` fragment is the answer to a sign-in this app started — or, since the Worker sends a
 * refusal back the same way, a `#error=<code>&…` one (D-57).
 * Returns null when the fragment is not a sign-in return at all. A refusal nobody asked for (no sign-in pending) is ignored
 * quietly: nothing was attempted, so there is nothing to report. A refusal carries the nonce when the Worker could read it
 * from the flow's cookie; when it could not (an expired flow) there is none, and the pending sign-in is the only check.
 */
export function checkReturn(hash: string, pending: Pending | null, now: number): ReturnResult | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get('token')
  const error = params.get('error')
  if (!token && !error) return null
  // Shape-checked: a stored `nonce: null` would match a link with no nonce, and a NaN `at` would skip the window.
  if (!pending || typeof pending.nonce !== 'string' || !Number.isFinite(pending.at)) {
    return token ? { ok: false, reason: 'no sign-in was started from this app — token ignored' } : null
  }
  if (now - pending.at > PENDING_TTL_MS) return { ok: false, reason: 'sign-in took over 10 minutes — start again' }
  const nonce = params.get('nonce')
  if (token) {
    if (nonce !== pending.nonce) return { ok: false, reason: 'nonce mismatch — token ignored' }
    return { ok: true, token, provider: pending.provider }
  }
  // Only an expired flow has no nonce to carry (the Worker could not read the flow's cookie). Any other refusal without one is
  // just a link: its text is not shown.
  if (nonce === null && error !== 'expired') return null
  if (nonce !== null && nonce !== pending.nonce) return { ok: false, reason: 'nonce mismatch — refusal ignored' }
  return { ok: false, reason: refusalMessage(error, params, pending.provider) }
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Leave the app for the provider. The Worker brings the browser back to the app root with the token. */
export function startSignIn(provider: Provider): void {
  const pending: Pending = { nonce: randomNonce(), provider, at: Date.now() }
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  localStorage.removeItem(RESULT_KEY) // a fresh attempt starts without the last attempt's verdict
  const returnTo = new URL(import.meta.env.BASE_URL, location.origin).href
  const url = new URL(`${API_URL}/auth/start/${provider}`)
  url.searchParams.set('return_to', returnTo)
  url.searchParams.set('nonce', pending.nonce)
  location.assign(url.href)
}

/**
 * Run before the router module loads (consumeReturn.ts): if the URL carries a sign-in return, check it, keep the token when it passes,
 * record the outcome for the test screen, and rewrite the URL to the app root (the token leaves the address bar).
 */
export function consumeSignInReturn(): void {
  const pending = readJson<Pending>(PENDING_KEY)
  const result = checkReturn(location.hash, pending, Date.now())
  if (!result) return
  // Token out of the address bar first: if storage throws below, the app must not be left holding it in the URL.
  history.replaceState(null, '', import.meta.env.BASE_URL)
  try {
    localStorage.removeItem(PENDING_KEY) // single use, pass or fail
    if (result.ok) localStorage.setItem(TOKEN_KEY, result.token)
    localStorage.setItem(
      RESULT_KEY,
      JSON.stringify({ at: Date.now(), text: result.ok ? `signed in with ${result.provider}` : `rejected: ${result.reason}` }),
    )
  } catch {
    // Storage blocked or full: the test screen shows "signed out" + no result, which is the truthful state.
  }
}

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function lastResult(): { at: number; text: string } | null {
  return readJson(RESULT_KEY)
}

export function signOutLocally(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Put a token back — only for an interrupted sign-out, which must leave the device as it found it. */
export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Storage blocked or full: the device stays signed out, which is the truthful state.
  }
}

/**
 * End this token's session on the server (`POST /auth/logout`, idempotent). Best effort: offline or refused, the session
 * simply lives to its 30-day expiry — signing out must never wait for the network. No `keepalive`: the route change to the
 * sign-in screen is not a page unload, and keepalive plus an Authorization header (a CORS preflight) is not reliable in
 * every browser — a flag that can silently drop the request is worse than none.
 */
export async function revokeSession(token: string, fetchImpl: typeof fetch = fetch, apiUrl = API_URL): Promise<boolean> {
  try {
    const res = await fetchImpl(`${apiUrl}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    return res.ok
  } catch {
    return false
  }
}

export type Me = { id: string; email: string; name: string | null }

/**
 * `/me` for the stored token: the user, 'signed-out' (no token, or 401), 'account-deleted' (401 that says why — the notes
 * on this device may be the only copy left), or an error string. A verdict, never an action: nothing here may touch the
 * device's data (D-55).
 */
export async function fetchMe(): Promise<Me | 'signed-out' | 'account-deleted' | { error: string }> {
  const token = storedToken()
  if (!token) return 'signed-out'
  try {
    const res = await fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string }
      return body.reason === 'account-deleted' ? 'account-deleted' : 'signed-out'
    }
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return (await res.json()) as Me
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
