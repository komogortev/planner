/**
 * Wraps an async function so a call made while one is still running is dropped (it resolves `undefined`), not queued. For
 * a button the owner may tap twice: the second tap must not run the action a second time. A call that throws releases the
 * guard, so one failure cannot lock the button.
 */
export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R | undefined> {
  let running = false
  return async (...args: A) => {
    if (running) return undefined
    running = true
    try {
      return await fn(...args)
    } finally {
      running = false
    }
  }
}
