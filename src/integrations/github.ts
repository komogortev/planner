// The GitHub connection, the app half (docs/GITHUB-BRIDGE.md §4; api/src/integrations.ts). The token is sent once, on
// connect, and never read back: the Worker answers with the login, the last 4 characters and the expiry only.
import { API_URL, storedToken } from '@/auth/signIn'

export type GithubConnection =
  | { provider: 'github'; connected: false }
  | { provider: 'github'; connected: true; login: string; keyHint: string; expiresAt: number | null; createdAt: number; updatedAt: number }

/** GitHub's page for a new fine-grained token. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'
/** What to choose on that page, shown under the link (§4: nothing broader). */
export const TOKEN_CHOICES: readonly string[] = [
  'Repository access: Only select repositories (the ones you want as projects)',
  'Metadata: Read-only',
  'Contents: Read-only',
  'Pull requests: Read-only',
  'Issues: Read and write',
]
/** Days before expiry at which the card starts warning. */
export const EXPIRY_WARN_DAYS = 14
const DAY = 86_400_000

/** The expiry line and whether it warns. */
export function expiryText(expiresAt: number | null, now: number): { text: string; warn: boolean } {
  if (expiresAt === null) return { text: 'no expiry date', warn: false }
  if (expiresAt <= now) return { text: 'expired: create a new token and paste it here', warn: true }
  const days = Math.ceil((expiresAt - now) / DAY)
  if (days <= EXPIRY_WARN_DAYS) return { text: days === 1 ? 'expires tomorrow' : `expires in ${days} days`, warn: true }
  return { text: `expires ${new Date(expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`, warn: false }
}

export class IntegrationsError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

type Fetch = typeof fetch
export interface Client { fetchImpl?: Fetch; apiUrl?: string; token?: string | null }

async function request<T>(init: RequestInit, c: Client = {}): Promise<T> {
  const token = c.token === undefined ? storedToken() : c.token
  if (!token) throw new IntegrationsError('Sign in first.', 401)
  let res: Response
  try {
    res = await (c.fetchImpl ?? fetch)(`${c.apiUrl ?? API_URL}/me/integrations/github`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    })
  } catch {
    throw new IntegrationsError('No connection to the server.', null)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const msg = res.status === 503 ? 'Integrations are not set up on the server yet.' : res.status === 401 ? 'Signed out. Sign in again.' : body.error ?? `HTTP ${res.status}`
    throw new IntegrationsError(msg, res.status)
  }
  return (await res.json()) as T
}

export const getGithub = (c?: Client) => request<GithubConnection>({ method: 'GET' }, c)
export const connectGithub = (token: string, c?: Client) => request<GithubConnection>({ method: 'PUT', body: JSON.stringify({ token }) }, c)
export const disconnectGithub = (c?: Client) => request<{ deleted: boolean }>({ method: 'DELETE' }, c)
