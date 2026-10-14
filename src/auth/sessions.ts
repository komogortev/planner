// The signed-in devices of the account (D-22; api/src/sessions.ts): list them, sign out one, sign out all others. This
// device signs out through Settings → Sign out, which also clears it; the Worker refuses to end it from the list.
import { API_URL, storedToken } from './signIn'

export interface SessionView {
  id: string
  device: string | null
  createdAt: number
  lastSeenAt: number
  current: boolean
}

export class SessionsError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

type Fetch = typeof fetch
export interface Client { fetchImpl?: Fetch; apiUrl?: string; token?: string | null }

async function request(path: string, init: RequestInit, c: Client = {}): Promise<Response> {
  const token = c.token === undefined ? storedToken() : c.token
  if (!token) throw new SessionsError('Sign in first.', 401)
  let res: Response
  try {
    res = await (c.fetchImpl ?? fetch)(`${c.apiUrl ?? API_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new SessionsError('No connection to the server.', null)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const msg = res.status === 401 ? 'Signed out. Sign in again.' : res.status === 404 ? 'That device is already signed out.' : body.error ?? `HTTP ${res.status}`
    throw new SessionsError(msg, res.status)
  }
  return res
}

export const listSessions = async (c?: Client): Promise<SessionView[]> =>
  ((await (await request('/me/sessions', { method: 'GET' }, c)).json()) as { sessions: SessionView[] }).sessions
export const signOutSession = async (id: string, c?: Client): Promise<void> => {
  await request(`/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }, c)
}
export const signOutOthers = async (c?: Client): Promise<number> =>
  ((await (await request('/me/sessions/others', { method: 'POST' }, c)).json()) as { signedOut: number }).signedOut

/** "Chrome on Android", or a plain fallback for a session from before device labels. */
export const deviceName = (s: Pick<SessionView, 'device'>) => s.device ?? 'Unknown device'

/** "today", "yesterday", "3 days ago", else the date: last seen moves at most daily (renewal), so finer is false precision. */
export function seenLabel(at: number, now: number = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * What the card lists up front: this device and the others seen today (the ones that may be in use right now); the rest
 * fold away (owner, 2026-10-14: a full list was mostly old sign-ins). "Today" is `seenLabel`'s, so a row never says
 * "last seen today" in one part and sits in the other.
 */
export function splitRecent<T extends Pick<SessionView, 'current' | 'lastSeenAt'>>(sessions: T[], now: number = Date.now()): { recent: T[]; older: T[] } {
  const recent: T[] = []
  const older: T[] = []
  for (const s of sessions) (s.current || seenLabel(s.lastSeenAt, now) === 'today' ? recent : older).push(s)
  return { recent, older }
}
