// H1-S1 spike sign-in: the app half of the Worker's /auth flow (api/src/auth.ts).
// Kept for S3, which replaces the test screen with the real account UI.

export const API_URL = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://planner-api.komogortev.workers.dev'

export type Provider = 'github' | 'google'

// localStorage, not sessionStorage: sessionStorage is per browsing context, and an iOS home-screen app may come back
// from the provider in a new one. The spike must measure whether the *token* survives, not lose the nonce first.
const PENDING_KEY = 'planner.signIn.pending'
const TOKEN_KEY = 'planner.signIn.token'
const RESULT_KEY = 'planner.signIn.lastResult'
const PENDING_TTL_MS = 10 * 60_000 // the Worker's flow cookie lives 10 minutes too

type Pending = { nonce: string; provider: Provider; at: number }
export type ReturnResult =
  | { ok: true; token: string; provider: Provider }
  | { ok: false; reason: string }

/**
 * Decide whether a `#token=…&nonce=…` fragment is the answer to a sign-in this app started.
 * Returns null when the fragment carries no token (not a sign-in return at all).
 */
export function checkReturn(hash: string, pending: Pending | null, now: number): ReturnResult | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get('token')
  if (!token) return null
  // Shape-checked: a stored `nonce: null` would match a link with no nonce, and a NaN `at` would skip the window.
  if (!pending || typeof pending.nonce !== 'string' || !Number.isFinite(pending.at)) {
    return { ok: false, reason: 'no sign-in was started from this app — token ignored' }
  }
  if (now - pending.at > PENDING_TTL_MS) return { ok: false, reason: 'sign-in took over 10 minutes — start again' }
  if (params.get('nonce') !== pending.nonce) return { ok: false, reason: 'nonce mismatch — token ignored' }
  return { ok: true, token, provider: pending.provider }
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
  const returnTo = new URL(import.meta.env.BASE_URL, location.origin).href
  const url = new URL(`${API_URL}/auth/start/${provider}`)
  url.searchParams.set('return_to', returnTo)
  url.searchParams.set('nonce', pending.nonce)
  location.assign(url.href)
}

/**
 * Run before the router module loads (consumeReturn.ts): if the URL carries a sign-in return, check it, keep the token when it passes,
 * record the outcome for the test screen, and rewrite the URL to that screen (the token leaves the address bar).
 */
export function consumeSignInReturn(): void {
  const pending = readJson<Pending>(PENDING_KEY)
  const result = checkReturn(location.hash, pending, Date.now())
  if (!result) return
  // Token out of the address bar first: if storage throws below, the app must not be left holding it in the URL.
  history.replaceState(null, '', `${import.meta.env.BASE_URL}spike-auth`)
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

export type Me = { id: string; email: string; name: string | null }

/** `/me` for the stored token: the user, 'signed-out' (no token or 401), or an error string. */
export async function fetchMe(): Promise<Me | 'signed-out' | { error: string }> {
  const token = storedToken()
  if (!token) return 'signed-out'
  try {
    const res = await fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) return 'signed-out'
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return (await res.json()) as Me
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** Installed home-screen app vs a browser tab — the question step 7 asks on the iPhone. */
export function displayMode(): 'standalone' | 'browser' {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
}
