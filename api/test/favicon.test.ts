import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const get = (appEnv: 'local' | 'prod') =>
  app.fetch(new Request('https://api.test/favicon.ico'), { ...env, APP_ENV: appEnv })

describe('API favicon', () => {
  it('prod: redirects to the app’s own favicon (unchanged default)', async () => {
    const res = await get('prod')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://app.test/planner/icon.svg')
  })

  it('local: serves the env-coloured API icon', async () => {
    const res = await get('local')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(await res.text()).toContain('>API<')
  })
})
