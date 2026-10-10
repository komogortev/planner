import { describe, expect, it } from 'vitest'
import { ENV_LOOK, envFor, envIcon } from '../appEnv'
import { applyEnvCue } from '../applyEnvCue'

describe('envFor', () => {
  it('dev server is local, wherever it is served', () => {
    expect(envFor(true, 'localhost')).toBe('local')
    expect(envFor(true, '192.168.1.20')).toBe('local') // phone on the LAN hitting the dev server
  })

  it('a production build on this machine or the home network is preview', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'pc.local', 'app.localhost', '192.168.1.20', '10.0.0.5', '172.16.0.2', '172.31.255.1']) {
      expect(envFor(false, h), h).toBe('preview')
    }
  })

  it('a production build anywhere else is prod', () => {
    for (const h of ['komogortev.github.io', 'planner.pages.dev', '172.32.0.1', '8.8.8.8', '192.169.1.1', 'localhost.evil.com']) {
      expect(envFor(false, h), h).toBe('prod')
    }
  })
})

describe('applyEnvCue', () => {
  // The guard that protects prod: in prod it must not touch the document at all. Any access throws here.
  it('prod: reads or writes nothing on the page', () => {
    const untouchable = new Proxy({} as Document, {
      get: (_t, prop) => {
        throw new Error(`prod touched document.${String(prop)}`)
      },
    })
    expect(() => applyEnvCue('prod', untouchable)).not.toThrow()
  })
})

describe('envIcon', () => {
  it('colours each non-prod env differently and tells app from API', () => {
    const icons = [envIcon('local', 'app'), envIcon('local', 'api'), envIcon('preview', 'app'), envIcon('preview', 'api')]
    expect(new Set(icons).size).toBe(4)
    expect(envIcon('local', 'app')).toContain(ENV_LOOK.local.accent)
    expect(envIcon('preview', 'app')).toContain(ENV_LOOK.preview.accent)
    expect(envIcon('local', 'app')).toContain('>PP<')
    expect(envIcon('local', 'api')).toContain('>API<')
  })

  it('every env has a distinct accent; prod has no label', () => {
    expect(new Set(Object.values(ENV_LOOK).map((l) => l.accent)).size).toBe(3)
    expect(ENV_LOOK.prod.label).toBe('')
  })
})
