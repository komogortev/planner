// Two windows of the app on one device (the installed app and a browser tab) each run their own sync engine over the SAME
// IndexedDB (D-59). Left alone they interleave: both read the same outbox, both push it, both write acknowledgements and pulled
// pages into the same tables. The cycle therefore runs under a Web Lock, one window at a time; the second waits its turn
// and then reads the outbox as it is by then (so nothing is pushed twice and nothing captured meanwhile is left behind).

/** The part of `navigator.locks` used here. */
export type LockManagerLike = {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>
}

/** Runs `fn` when it is this window's turn. Resolves whether it ran: false = the wait was given up and `fn` never ran. */
export type CycleLock = (fn: () => Promise<void>) => Promise<boolean>

const LOCK_NAME = 'planner-sync'

/**
 * The cycle lock, or undefined where there is no Web Locks API (the engine then runs as it always did). A window waits at
 * most `waitMs` for its turn: if the other window is stuck on a request that never answers, this one gives the attempt up
 * and the next trigger (the poll, a capture, coming back online) tries again, instead of queueing behind it for ever.
 */
export function createCycleLock(locks: LockManagerLike | undefined, opts: { waitMs?: number } = {}): CycleLock | undefined {
  if (!locks) return undefined
  const waitMs = opts.waitMs ?? 30_000
  return async (fn) => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), waitMs)
    // `false` has to mean "fn never ran", so what failed is told apart by whether it had started.
    let started = false
    try {
      await locks.request(LOCK_NAME, { signal: abort.signal }, async () => {
        started = true
        clearTimeout(timer) // it is this window's turn: the WAIT is what is bounded here (the cycle bounds its own requests)
        await fn()
      })
      return true
    } catch (err) {
      if (started) throw err // the cycle's own failure, whatever its name
      if ((err as { name?: string }).name === 'AbortError') return false // the wait was given up
      // The lock itself could not be taken (an opaque origin, a document that is not active): that is no reason to stop syncing.
      // Run the cycle without it, as the engine did before there was a lock.
      await fn()
      return true
    } finally {
      clearTimeout(timer)
    }
  }
}
