import { beforeEach, describe, expect, it } from 'vitest'
import { reportError, resetReportThrottleForTests, type ReportDeps } from '../report'

let sent: { url: string; body: Record<string, unknown> }[]
let clock = 1_000_000
const deps = (over: Partial<ReportDeps> = {}): ReportDeps => ({
  fetch: (async (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) }); return new Response(null, { status: 204 }) }) as never,
  apiUrl: 'https://api.test', build: 'ccca2cf', route: () => '/settings', now: () => clock, enabled: true, ...over,
})

beforeEach(() => { sent = []; clock = 1_000_000; resetReportThrottleForTests() })

describe('reportError', () => {
  // Known positive: a report is really sent, so the "nothing sent" cases below cannot pass vacuously.
  it('sends kind, route and build, and nothing else', async () => {
    expect(await reportError('js-error', deps())).toBe(true)
    expect(sent).toEqual([{ url: 'https://api.test/log', body: { kind: 'js-error', route: '/settings', build: 'ccca2cf' } }])
  })

  it('sends nothing when disabled (dev server, offline)', async () => {
    expect(await reportError('js-error', deps({ enabled: false }))).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('sends one report per kind per minute, and another kind is not held back', async () => {
    expect(await reportError('js-error', deps())).toBe(true)
    clock += 30_000
    expect(await reportError('js-error', deps())).toBe(false)
    expect(await reportError('promise-rejected', deps())).toBe(true)
    clock += 31_000
    expect(await reportError('js-error', deps())).toBe(true)
    expect(sent).toHaveLength(3)
  })

  it('a failing request is swallowed (reporting must never cause the next error)', async () => {
    const failing = deps({ fetch: (async () => { throw new TypeError('Failed to fetch') }) as never })
    await expect(reportError('js-error', failing)).resolves.toBe(false)
  })
})
