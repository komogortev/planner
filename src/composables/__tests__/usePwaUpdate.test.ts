import { describe, expect, it } from 'vitest'
import { watchForUpdates } from '../usePwaUpdate'

function setup(o: { online?: boolean; update?: () => Promise<unknown> } = {}) {
  const listeners: Array<[string, () => void]> = []
  const doc = { visibilityState: 'visible', addEventListener: (t: string, fn: () => void) => void listeners.push([t, fn]) }
  let updates = 0
  watchForUpdates({ update: (o.update ?? (async () => { updates++ })) as never }, { doc: doc as never, online: () => o.online ?? true })
  const go = (state: 'visible' | 'hidden') => { doc.visibilityState = state; for (const [, fn] of listeners) fn() }
  return { listeners, go, updates: () => updates }
}

describe('watchForUpdates', () => {
  it('looks for a new build when the app goes to the background', () => {
    const s = setup()
    expect(s.listeners.map(([t]) => t)).toEqual(['visibilitychange'])
    s.go('hidden')
    expect(s.updates()).toBe(1)
  })

  it('never while he is using it (a check in front reloads mid-typing), and not offline', () => {
    const s = setup()
    s.go('visible')
    expect(s.updates()).toBe(0)
    const off = setup({ online: false })
    off.go('hidden')
    expect(off.updates()).toBe(0)
  })

  it('a failed look, rejected or thrown, is swallowed', async () => {
    expect(() => setup({ update: () => Promise.reject(new Error('offline')) }).go('hidden')).not.toThrow()
    expect(() => setup({ update: () => { throw new Error('sync') } }).go('hidden')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0)) // an unhandled rejection would fail the run
  })
})
