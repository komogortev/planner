import { describe, expect, it } from 'vitest'
import { UPDATE_EVERY_MS, watchForUpdates } from '../usePwaUpdate'

function setup(o: { visible?: boolean; online?: boolean } = {}) {
  const listeners: Array<[string, () => void]> = []
  const timers: Array<[() => void, number]> = []
  const doc = { visibilityState: (o.visible ?? true) ? 'visible' : 'hidden', addEventListener: (t: string, fn: () => void) => void listeners.push([t, fn]) }
  let updates = 0
  const check = watchForUpdates({ update: async () => { updates++; return undefined as never } }, {
    doc: doc as never,
    online: () => o.online ?? true,
    every: (fn, ms) => void timers.push([fn, ms]),
  })
  return { listeners, timers, doc, check, updates: () => updates }
}

describe('watchForUpdates', () => {
  it('looks for a new build when the app comes to the front, and every half hour', () => {
    const s = setup()
    expect(s.listeners.map(([t]) => t)).toEqual(['visibilitychange'])
    expect(s.timers.map(([, ms]) => ms)).toEqual([UPDATE_EVERY_MS])
    s.listeners[0][1]()
    s.timers[0][0]()
    expect(s.updates()).toBe(2)
  })

  it('does not look while hidden or offline', () => {
    expect((() => { const s = setup({ visible: false }); s.check(); return s.updates() })()).toBe(0)
    expect((() => { const s = setup({ online: false }); s.check(); return s.updates() })()).toBe(0)
  })

  it('a failed look is swallowed (the next one tries again)', async () => {
    const check = watchForUpdates({ update: () => Promise.reject(new Error('offline')) }, {
      doc: { visibilityState: 'visible', addEventListener: () => {} } as never, online: () => true, every: () => 0,
    })
    expect(() => check()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0)) // an unhandled rejection would fail the run
  })
})
