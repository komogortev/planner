// D-59: two windows of the app on one device (the installed app and a browser tab) each run their own sync engine over the
// SAME IndexedDB. The cycle runs under a Web Lock so they take turns. `createCycleLock` is the wrapper; the Web Locks API
// itself is replaced here by a small FIFO that honours an abort signal the way the real one does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCycleLock } from '../lock'
import { fakeLocks } from './fakeLocks'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createCycleLock', () => {
  afterEach(() => vi.useRealTimers())

  // Known positive: with the lock, two cycles that would overlap run one after the other.
  it('runs the cycles of two windows one at a time, in the order they asked', async () => {
    const lock = createCycleLock(fakeLocks(), { waitMs: 1_000 })!
    const log: string[] = []
    const cycle = (name: string) => async () => { log.push(`${name} start`); await sleep(10); log.push(`${name} end`) }
    const [a, b] = await Promise.all([lock(cycle('A')), lock(cycle('B'))])
    expect([a, b]).toEqual([true, true])
    expect(log).toEqual(['A start', 'A end', 'B start', 'B end'])
  })

  it('a window that waits too long gives the attempt up: false, and its cycle never runs', async () => {
    const lock = createCycleLock(fakeLocks(), { waitMs: 20 })!
    let ranB = false
    const slow = lock(async () => { await sleep(80) }) // another window, stuck on a request
    const waiting = lock(async () => { ranB = true })
    expect(await waiting).toBe(false)
    expect(ranB).toBe(false)
    expect(await slow).toBe(true)
  })

  it('the lock is released when a cycle throws, so the next window is not locked out', async () => {
    const locks = fakeLocks()
    const lock = createCycleLock(locks, { waitMs: 1_000 })!
    await expect(lock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(locks.held()).toBe(false)
    let ran = false
    expect(await lock(async () => { ran = true })).toBe(true)
    expect(ran).toBe(true)
  })

  it('names the lock the same for every window', async () => {
    const names: string[] = []
    const locks = { request: async (name: string, _o: unknown, cb: () => Promise<unknown>) => { names.push(name); return cb() } } as never
    const lock = createCycleLock(locks, { waitMs: 1_000 })!
    await lock(async () => undefined)
    await lock(async () => undefined)
    expect(new Set(names).size).toBe(1)
  })

  // Review finding (A3): a lock that cannot be taken at all (an opaque origin, a document that is not active) used to reject
  // every sync for ever. It is not a reason to stop syncing: run the cycle, unlocked, as the engine always did.
  it('a lock that cannot be taken runs the cycle anyway, unlocked', async () => {
    const locks = { request: async () => { throw Object.assign(new Error('opaque origin'), { name: 'SecurityError' }) } }
    const lock = createCycleLock(locks as never)!
    let ran = false
    expect(await lock(async () => { ran = true })).toBe(true)
    expect(ran).toBe(true)
  })

  // `false` means the cycle did not run. An AbortError raised BY the cycle is not a wait that was given up.
  it('an AbortError from the cycle itself is not "the wait was given up"', async () => {
    const lock = createCycleLock(fakeLocks(), { waitMs: 1_000 })!
    await expect(lock(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) })).rejects.toThrow('x')
  })

  // A browser without the Web Locks API (or a test) gets no lock at all: the engine then runs as it always did.
  it('without a Web Locks API there is no lock', () => {
    expect(createCycleLock(undefined)).toBeUndefined()
  })

  it('does not leave its timeout running after the cycle finished', async () => {
    vi.useFakeTimers()
    const lock = createCycleLock(fakeLocks(), { waitMs: 30_000 })!
    const done = lock(async () => undefined)
    await vi.advanceTimersByTimeAsync(0)
    await done
    expect(vi.getTimerCount()).toBe(0)
  })
})
