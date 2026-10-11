// The part of navigator.locks the cycle lock uses, as a small FIFO that honours an abort signal the way the real one does.
import type { LockManagerLike } from '../lock'

/** The part of navigator.locks the wrapper uses: exclusive, first come first served, a waiting request can be aborted. */
export function fakeLocks(): LockManagerLike & { held: () => boolean } {
  let tail: Promise<unknown> = Promise.resolve()
  let held = false
  return {
    held: () => held,
    request(_name, options, callback) {
      const signal = options.signal
      return new Promise((resolve, reject) => {
        let started = false
        const onAbort = () => { if (!started) reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }
        signal?.addEventListener('abort', onAbort)
        const mine = tail.then(async () => {
          if (signal?.aborted) return
          started = true
          held = true
          try { resolve(await callback()) } catch (err) { reject(err) } finally { held = false }
        })
        tail = mine
      })
    },
  } as never
}
