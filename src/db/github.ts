/**
 * GitHub Contents API client for L1 sync.
 *
 * Thin fetch wrapper that maps HTTP failures to typed `GitHubError` objects
 * with user-facing copy and recovery hints. See `docs/L1-GITHUB.md` for the
 * full error mapping table.
 *
 * S1 scope: auth validation only (`getUser`, `getRepo`).
 * S2 adds: `getDataJson`.
 * S3 will add: `putDataJson`, `getLatestDataCommit`.
 */

const GITHUB_API = 'https://api.github.com'

export type GitHubErrorKind =
  | 'unauthorized'        // 401 — token rejected
  | 'not-found'           // 404 — repo or file missing
  | 'public-repo'         // repo exists but is public — refuse
  | 'rate-limited'        // 403 with X-RateLimit-Remaining: 0
  | 'conflict'            // 409 (or 422 sha mismatch) — for S3
  | 'network'             // fetch threw (offline, DNS, CORS)
  | 'unknown'             // anything else

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind
  /** User-facing copy. Safe to render directly. */
  readonly userMessage: string
  /** Optional follow-up hint (e.g. rate-limit reset time). */
  readonly hint?: string

  constructor(kind: GitHubErrorKind, userMessage: string, hint?: string) {
    super(userMessage)
    this.name = 'GitHubError'
    this.kind = kind
    this.userMessage = userMessage
    this.hint = hint
  }
}

interface GitHubUser {
  login: string
}

interface GitHubRepo {
  name: string
  full_name: string
  private: boolean
}

/**
 * Validate a PAT by fetching the authenticated user.
 * Returns the user's login on success.
 */
export async function getUser(pat: string): Promise<GitHubUser> {
  const res = await ghFetch(`${GITHUB_API}/user`, pat)
  if (res.status === 401) {
    throw new GitHubError(
      'unauthorized',
      'GitHub rejected your token. Check it and try again.',
    )
  }
  if (!res.ok) {
    throw genericHttpError(res)
  }
  return (await res.json()) as GitHubUser
}

/**
 * Fetch a repo. Returns the repo metadata.
 *
 * Throws:
 *   - `not-found` if the repo doesn't exist or the PAT can't see it
 *   - `public-repo` if the repo exists but is public — refuse to use it
 */
export async function getRepo(
  pat: string,
  owner: string,
  repo: string,
): Promise<GitHubRepo> {
  const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}`, pat)
  if (res.status === 404) {
    throw new GitHubError(
      'not-found',
      `Repo ${owner}/${repo} not found, or your token doesn't have access. ` +
        `Check the spelling and your token's repository access list. ` +
        `(If you just created or updated the PAT, wait 30 seconds — GitHub takes ` +
        `a moment to propagate access changes.)`,
    )
  }
  if (res.status === 401) {
    throw new GitHubError(
      'unauthorized',
      'GitHub rejected your token. Check it and try again.',
    )
  }
  if (!res.ok) {
    throw genericHttpError(res)
  }
  const meta = (await res.json()) as GitHubRepo
  if (!meta.private) {
    throw new GitHubError(
      'public-repo',
      `Repo ${owner}/${repo} is public. Refusing to write personal data to a ` +
        `public repo. Make it private in GitHub settings and reconnect.`,
    )
  }
  return meta
}

/**
 * Fetch `data.json` from the data repo. Returns the raw JSON text + the blob
 * sha (used as the optimistic-concurrency token for subsequent PUTs).
 *
 * Uses the standard JSON wrapper (not `Accept: vnd.github.raw`) so we get
 * `{ content, sha }` in a single response — see L1-GITHUB.md "Restore (S2)".
 *
 * Throws:
 *   - `not-found` if no `data.json` exists yet (first-run case)
 *   - `unauthorized` if the PAT is rejected
 *   - `rate-limited` / `network` / `unknown` per `genericHttpError`
 */
export async function getDataJson(
  pat: string,
  owner: string,
  repo: string,
): Promise<{ rawText: string; sha: string }> {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/data.json`,
    pat,
  )
  if (res.status === 404) {
    throw new GitHubError(
      'not-found',
      `No data.json yet in ${owner}/${repo}. Run "Sync now" on a device that ` +
        `has data to seed it. (If you just created or updated the PAT, wait ` +
        `30 seconds — GitHub takes a moment to propagate access changes.)`,
    )
  }
  if (res.status === 401) {
    throw new GitHubError(
      'unauthorized',
      'GitHub rejected your token. Reconnect in Settings.',
    )
  }
  if (!res.ok) {
    throw genericHttpError(res)
  }
  const body = (await res.json()) as {
    content?: string
    encoding?: string
    sha?: string
  }
  if (!body.sha || typeof body.content !== 'string' || body.encoding !== 'base64') {
    throw new GitHubError(
      'unknown',
      'GitHub returned an unexpected response shape for data.json.',
    )
  }
  // GitHub wraps base64 at column 60 with newlines; atob rejects them.
  const cleanBase64 = body.content.replace(/\n/g, '')
  const rawText = decodeBase64Utf8(cleanBase64)
  return { rawText, sha: body.sha }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string as UTF-8. `atob` returns a binary string of code
 * units 0–255, which corrupts multi-byte characters (e.g. emoji) — we route
 * the bytes through TextDecoder to recover the original text.
 */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

async function ghFetch(url: string, pat: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    // fetch only throws on network-level failures (offline, DNS, CORS, etc.)
    throw new GitHubError(
      'network',
      "Can't reach github.com. Check your connection and try again.",
      err instanceof Error ? err.message : undefined,
    )
  }
}

function genericHttpError(res: Response): GitHubError {
  if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = res.headers.get('X-RateLimit-Reset')
    const resetAt = reset ? new Date(Number(reset) * 1000) : null
    const when = resetAt ? resetAt.toLocaleTimeString() : 'later'
    return new GitHubError(
      'rate-limited',
      `Hit GitHub rate limit. Try again at ${when}.`,
    )
  }
  return new GitHubError(
    'unknown',
    `GitHub request failed with status ${res.status}.`,
  )
}

/**
 * Generate a deviceId in the format `${platform}-${YYYY-MM-DD}` of today.
 *
 * Platform is a coarse heuristic — phone if narrow + touch, tablet if wider +
 * touch, desktop otherwise. Used in commit messages and data.json snapshots
 * for diagnostic purposes only; does not affect routing or behavior.
 */
export function generateDeviceId(): string {
  const platform = detectPlatform()
  const today = new Date().toISOString().slice(0, 10)
  return `${platform}-${today}`
}

function detectPlatform(): 'phone' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined' || typeof matchMedia === 'undefined') {
    return 'desktop'
  }
  const isTouch = matchMedia('(pointer: coarse)').matches
  if (!isTouch) return 'desktop'
  const narrow = matchMedia('(max-width: 600px)').matches
  return narrow ? 'phone' : 'tablet'
}
