// The app reports that it broke (S4, D-24) to POST /log: an error KIND, the route and the build id. Never a message, a
// stack or anything from a note — a message can quote the text the owner wrote, and this repo and the log are not the
// place for it. Best effort: a failure to report is swallowed, because reporting must never cause the next error.
import { API_URL } from '@/auth/signIn'
import { BUILD } from '@/env/version'

const MIN_GAP_MS = 60_000
const lastSent = new Map<string, number>()

/** Kinds are lowercase words with `.`, `_`, `-`, `:` (the Worker refuses anything else). */
export type ErrorKind = 'js-error' | 'promise-rejected' | 'stale-build' | `sync-${string}`

export interface ReportDeps {
  fetch: typeof fetch
  apiUrl: string
  build: string
  route: () => string
  now: () => number
  enabled: boolean
}

const browserDeps = (): ReportDeps => ({
  fetch: (...a) => fetch(...a),
  apiUrl: API_URL,
  build: BUILD.commit.replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 40) || 'unknown',
  route: () => location.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ''), '') || '/',
  now: Date.now,
  // Not from the dev server (its errors are the developer's own) and not while offline (it would only fail).
  enabled: !import.meta.env.DEV && (typeof navigator === 'undefined' || navigator.onLine),
})

/** Send one report, at most one per kind per minute. Returns whether a request was made. */
export async function reportError(kind: ErrorKind, deps: ReportDeps = browserDeps()): Promise<boolean> {
  if (!deps.enabled) return false
  const t = deps.now()
  const prev = lastSent.get(kind)
  if (prev !== undefined && t - prev < MIN_GAP_MS) return false
  lastSent.set(kind, t)
  try {
    await deps.fetch(`${deps.apiUrl}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, route: deps.route(), build: deps.build }),
      keepalive: true,
    })
    return true
  } catch {
    return false
  }
}

export function resetReportThrottleForTests(): void {
  lastSent.clear()
}

/** Wire the page-level handlers once. */
export function installErrorReporting(): void {
  window.addEventListener('error', () => void reportError('js-error'))
  window.addEventListener('unhandledrejection', () => void reportError('promise-rejected'))
}
