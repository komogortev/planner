import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

const get = (appEnv: 'local' | 'prod') =>
  app.fetch(new Request('https://api.test/favicon.ico'), { ...env, APP_ENV: appEnv })

const REAL_ICON = '<svg data-real-icon="1"/>'

afterEach(() => vi.restoreAllMocks())

describe('API favicon', () => {
  // Bytes, not a redirect: browsers did not follow a redirected /favicon.ico in production.
  it('prod: serves the app’s own icon.svg bytes (unchanged default)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(REAL_ICON, { status: 200 }))
    const res = await get('prod')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(await res.text()).toBe(REAL_ICON)
    expect(String(spy.mock.calls[0][0])).toBe('https://app.test/planner/icon.svg')
  })

  it('prod: no icon (404), not an error, when the app’s icon cannot be fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }))
    expect((await get('prod')).status).toBe(404)
  })

  it('local: serves the env-coloured API icon, without fetching anything', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const res = await get('local')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(await res.text()).toContain('>API<')
    expect(spy).not.toHaveBeenCalled()
  })
})
