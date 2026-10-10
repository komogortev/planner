// Rate limits (H1-ENTRIES.md §8) on Workers' rate-limiting binding. Counters are per Cloudflare location and eventually
// consistent: this stops a looping client or a flood, it is not exact accounting. The limits live in wrangler.toml.
//
// Not a D1 counter: that would turn every unauthenticated request into a D1 write, burning the free-tier quota the limit
// exists to protect.
import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from './index'

type Binding = 'RL_AUTH_IP' | 'RL_PUSH_IP' | 'RL_PUSH_USER'

/** Over the limit? A limiter that is missing or throws lets the request through and says so — a personal app prefers
 *  availability to a lockout, and the log keeps the failure from being silent. */
export async function overLimit(env: Env, binding: Binding, key: string): Promise<boolean> {
  const limiter = env[binding]
  if (!limiter) { console.error(`rate limit: binding ${binding} is not configured`); return false }
  try {
    return !(await limiter.limit({ key })).success
  } catch (err) {
    console.error(`rate limit: ${binding} failed`, err instanceof Error ? err.message : err)
    return false
  }
}

// The window the bindings are configured with (wrangler.toml), for the client's backoff.
export const RETRY_AFTER_SECONDS = 60

export const tooMany = (c: Context) => {
  c.header('Retry-After', String(RETRY_AFTER_SECONDS))
  return c.json({ error: 'rate limited' }, 429)
}

/**
 * What one caller is counted as. IPv4: the address. IPv6: the /64 — one host controls a whole /64 and could otherwise
 * use a fresh address per request.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.split('::')
  const a = head ? head.split(':') : []
  const b = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

let warnedNoIp = false
/** Test seam: forget that the missing-header warning was already given. */
export const resetNoIpWarning = () => { warnedNoIp = false }

/** The caller's address as Cloudflare saw it. Absent locally (no Cloudflare in front) — then there is nothing to key on. */
function clientIp(c: Context<{ Bindings: Env }>): string | null {
  const ip = c.req.header('CF-Connecting-IP') ?? null
  // In production a missing header means the per-IP guard is silently off; say so once per isolate.
  if (!ip && c.env.APP_ENV !== 'local' && !warnedNoIp) {
    warnedNoIp = true
    console.error('rate limit: no CF-Connecting-IP on a non-local request; per-IP limits are not applied')
  }
  return ip
}

/** Per-IP limit. Runs before authentication, so a flood costs no D1 read. */
export const byIp = (binding: 'RL_AUTH_IP' | 'RL_PUSH_IP'): MiddlewareHandler<{ Bindings: Env }> => async (c, next) => {
  const ip = clientIp(c)
  if (ip && (await overLimit(c.env, binding, ipKey(ip)))) return tooMany(c)
  await next()
}
