// H1 §8 rate limits. The limits come from wrangler.toml (auth 20/min per IP, push 60/min per IP, push 20/min per user);
// each test uses fresh addresses and accounts, so counters from one test never reach another.
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/auth'
import app from '../src/index'
import { ipKey, overLimit, resetNoIpWarning } from '../src/ratelimit'

// The local limiter counts in fixed windows aligned to the wall clock (miniflare: epoch = floor(now / period)), so a test that
// sends 21 requests across a minute boundary sees its counter reset and never gets the 429. Start each test clear of the edge.
beforeEach(async () => {
  const left = 60_000 - (Date.now() % 60_000)
  if (left < 5_000) await new Promise((r) => setTimeout(r, left + 100))
})

const API = 'https://api.test'
const APP_ORIGIN = 'https://app.test'

let n = 0
const freshIp = () => `203.0.113.${++n}`
const call = async (path: string, init: RequestInit & { ip?: string; token?: string } = {}) => {
  const { ip, token, headers, ...rest } = init
  return await app.fetch(
    new Request(`${API}${path}`, {
      ...rest,
      headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: APP_ORIGIN, ...(headers ?? {}) },
    }),
    env,
  )
}

async function account() {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, `${id}@example.com`, null, Date.now()).run()
  return { id, token: await createSession(env.DB, id) }
}

const entry = () => ({
  id: crypto.randomUUID(), body: 'hello', createdAt: '2026-10-10T08:00:00.000Z', occurredAt: null, categoryId: null, tags: [],
  origin: 'author', updatedAt: '2026-10-10T08:00:00.000Z', deletedAt: null,
})
const push = (token: string, ip?: string) => {
  const e = entry()
  return call('/sync/push', { method: 'POST', token, ip, body: JSON.stringify({ mutations: [{ entityId: e.id, op: 'upsert', baseVersion: null, payload: e }] }) })
}
const statuses = async (n: number, f: () => Promise<Response>) => {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((await f()).status)
  return out
}
const entries = async () => ((await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first<{ n: number }>())!.n)

describe('auth: per IP', () => {
  // `/auth/start` with no params answers 400 — cheap, and it still counts. The 21st is the known positive.
  it('allows 20 a minute from one address, then 429 with Retry-After and CORS headers the app can read', async () => {
    const ip = freshIp()
    const codes = await statuses(21, () => call('/auth/start/github', { ip }))
    expect(codes.slice(0, 20).every((c) => c === 400)).toBe(true)
    expect(codes[20]).toBe(429)

    const res = await call('/auth/start/github', { ip })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN) // else the browser hides the 429 from the client
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After') // else it cannot read how long to wait
    expect(await res.json()).toEqual({ error: 'rate limited' })
  })

  it("another address is not affected by one that is over (negative control)", async () => {
    const noisy = freshIp()
    await statuses(25, () => call('/auth/start/github', { ip: noisy }))
    expect((await call('/auth/start/github', { ip: freshIp() })).status).toBe(400)
  })

  it('also covers the callback and logout, but not /health or /me', async () => {
    const ip = freshIp()
    await statuses(20, () => call('/auth/logout', { method: 'POST', ip }))
    expect((await call('/auth/callback/github', { ip })).status).toBe(429)
    expect((await call('/auth/logout', { method: 'POST', ip })).status).toBe(429)
    expect((await call('/health', { ip })).status).toBe(200)
    expect((await call('/me', { ip })).status).toBe(401)
  })

  it('a request with no CF-Connecting-IP (local dev) has nothing to key on and is not limited', async () => {
    expect((await statuses(25, () => call('/auth/start/github'))).every((c) => c === 400)).toBe(true)
  })
})

describe('push: per user', () => {
  it('allows 20 pushes a minute for an account, then 429 — and the refused push writes nothing', async () => {
    const a = await account()
    const codes = await statuses(21, () => push(a.token))
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true)
    expect(codes[20]).toBe(429)
    expect(await entries()).toBe(20) // the 21st never reached the data layer
  })

  it('another account is not affected by one that is over (negative control)', async () => {
    const noisy = await account()
    const quiet = await account()
    await statuses(25, () => push(noisy.token))
    expect((await push(quiet.token)).status).toBe(200)
  })

  it('does not limit pull or reads', async () => {
    const a = await account()
    await statuses(25, () => push(a.token))
    expect((await call('/sync/pull', { token: a.token })).status).toBe(200)
    expect((await call('/entries', { token: a.token })).status).toBe(200)
  })

  it('is keyed on the session\'s account, so a second token for it shares the budget', async () => {
    const a = await account()
    const second = await createSession(env.DB, a.id)
    await statuses(20, () => push(a.token))
    expect((await push(second)).status).toBe(429)
  })
})

describe('push: per IP', () => {
  // The IP limit runs before authentication: without a token the answers are 401 until the address is over, then 429.
  it('limits an address at 60 a minute, ahead of the auth lookup', async () => {
    const ip = freshIp()
    const codes = await statuses(61, () => call('/sync/push', { method: 'POST', ip, body: '{}' }))
    expect(codes.slice(0, 60).every((c) => c === 401)).toBe(true)
    expect(codes[60]).toBe(429)
  })

  it("two accounts behind one address share its budget, another address does not", async () => {
    const ip = freshIp()
    const a = await account()
    const b = await account()
    const codes = await statuses(60, () => push(a.token, ip))
    expect(codes.every((c) => c === 200 || c === 429)).toBe(true) // user limit trips at 20; the IP counts every attempt
    expect((await push(b.token, ip)).status).toBe(429)
    expect((await push(b.token, freshIp())).status).toBe(200)
  })
})

describe('IPv6 callers are counted by /64', () => {
  it('maps every address in one /64 to one key, and different /64s to different keys', () => {
    const a = ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    expect(a).toBe('2001:db8:1:2::/64')
    expect(ipKey('2001:db8:1:2:1::9')).toBe(a)
    expect(ipKey('2001:0DB8:0001:0002::1')).toBe(a)
    expect(ipKey('2001:db8:1:3::1')).not.toBe(a)
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64') // `::` expands to zero groups
    expect(ipKey('::1')).toBe('0:0:0:0::/64')
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7') // IPv4 unchanged
  })

  it('a flood that rotates addresses inside one /64 is still limited, and another /64 is not', async () => {
    const prefix = `2001:db8:77:${++n}`
    let i = 0
    const codes = await statuses(21, () => call('/auth/start/github', { ip: `${prefix}::${++i}` }))
    expect(codes.slice(0, 20).every((c) => c === 400)).toBe(true)
    expect(codes[20]).toBe(429)
    expect((await call('/auth/start/github', { ip: `2001:db8:78:${++n}::1` })).status).toBe(400)
  })

  it('a missing address header outside local dev is reported once, not silently skipped', async () => {
    resetNoIpWarning()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await call('/auth/start/github')
    await call('/auth/start/github')
    expect(log.mock.calls.filter((c) => String(c[0]).includes('no CF-Connecting-IP'))).toHaveLength(1)
    log.mockRestore()
  })

  it('a limiter that throws does not break the request itself (HTTP level)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { ...env, RL_AUTH_IP: { limit: async () => { throw new Error('limiter down') } } } as unknown as typeof env
    const res = await app.fetch(new Request(`${API}/auth/start/github`, { headers: { 'CF-Connecting-IP': freshIp() } }), broken)
    expect(res.status).toBe(400) // the route's own answer, not a 429 or a 500
    log.mockRestore()
  })
})

describe('a limiter that cannot answer', () => {
  it('lets the request through and logs, rather than locking the owner out', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { ...env, RL_AUTH_IP: { limit: async () => { throw new Error('limiter down') } } } as unknown as typeof env
    expect(await overLimit(broken, 'RL_AUTH_IP', 'k')).toBe(false)
    expect(log).toHaveBeenCalledWith('rate limit: RL_AUTH_IP failed', 'limiter down')

    const missing = { ...env, RL_AUTH_IP: undefined } as unknown as typeof env
    expect(await overLimit(missing, 'RL_AUTH_IP', 'k')).toBe(false)
    expect(log).toHaveBeenCalledWith('rate limit: binding RL_AUTH_IP is not configured')
    log.mockRestore()
  })

  it('a limiter that says no is believed', async () => {
    const no = { ...env, RL_AUTH_IP: { limit: async () => ({ success: false }) } } as unknown as typeof env
    expect(await overLimit(no, 'RL_AUTH_IP', 'k')).toBe(true)
  })
})
