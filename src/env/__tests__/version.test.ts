import { describe, expect, it } from 'vitest'
import { BUILD, versionLabel } from '../version'

const b = { version: '1.2.3', commit: '6ef0d07', builtAt: '2026-10-10T13:33:00.000Z' }

describe('versionLabel', () => {
  it('built app: version · commit · build time', () => {
    expect(versionLabel(b, 'prod')).toMatch(/^v1\.2\.3 · 6ef0d07 · \d{2}-\d{2} \d{2}:\d{2}$/)
    expect(versionLabel(b, 'preview')).toMatch(/^v1\.2\.3 · 6ef0d07 · /)
  })

  it('dev server: says dev instead of a start time', () => {
    expect(versionLabel({ ...b, commit: '6ef0d07+' }, 'local')).toBe('v1.2.3 · 6ef0d07+ · dev')
  })
})

describe('BUILD (injected by vite.config.ts)', () => {
  it('carries package.json’s version and a git commit', async () => {
    const pkg = (await import('../../../package.json')).default as { version: string }
    expect(BUILD.version).toBe(pkg.version)
    expect(BUILD.commit).toMatch(/^[0-9a-f]{7,}\+?$/)
    expect(Number.isNaN(Date.parse(BUILD.builtAt))).toBe(false)
  })
})
