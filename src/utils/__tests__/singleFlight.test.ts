import { describe, expect, it } from 'vitest'
import { singleFlight } from '../singleFlight'

const gate = () => {
  let open!: () => void
  const wait = new Promise<void>((r) => { open = r })
  return { wait, open }
}

describe('singleFlight', () => {
  // Known positive: a lone call runs, so "the second call did nothing" cannot pass on a wrapper that never calls.
  it('runs the function and returns what it returned', async () => {
    const f = singleFlight(async (n: number) => n * 2)
    expect(await f(21)).toBe(42)
  })

  it('a call made while one is running is dropped, not queued', async () => {
    const g = gate()
    let runs = 0
    const f = singleFlight(async () => { runs++; await g.wait; return 'done' })
    const first = f()
    const second = f() // a double tap
    expect(await second).toBeUndefined()
    g.open()
    expect(await first).toBe('done')
    expect(runs).toBe(1)
  })

  it('runs again once the earlier call has finished', async () => {
    let runs = 0
    const f = singleFlight(async () => { runs++ })
    await f()
    await f()
    expect(runs).toBe(2)
  })

  // Negative control: a function that throws must not leave the guard shut for ever.
  it('a call that throws releases the guard', async () => {
    let runs = 0
    const f = singleFlight(async () => { runs++; if (runs === 1) throw new Error('boom') })
    await expect(f()).rejects.toThrow('boom')
    await f()
    expect(runs).toBe(2)
  })
})
