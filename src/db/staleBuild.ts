// A6 (SLICE-ACCEPTANCE §1, D-118): a build older than the data on this device must not open it. Dexie 4 does not refuse a
// downgrade: it reopens at the stored version, re-adds whatever the older schema expects and bumps the stored version, so
// an older build (a Pages rollback) runs on, writes and syncs newer data, and the newer build's upgrade steps never run
// again once it returns. Measured 2026-10-14 (fake-indexeddb, Dexie 4.4.2): v7 data opened by a v6 build → opened, native
// 70 → 71; v7 again → opened, the old build's sync cursor kept.
//
// So the check runs BEFORE Dexie opens, and reads the stored version without opening anything: `indexedDB.open(name)`
// with no version would create a missing database at version 1. `databases()` only lists.

/**
 * Dexie stores `version(n)` as native version n × 10, and a schema patch adds 1 (70 → 71), so compare the tens. Ten
 * patches at one version (a schema changed without a `version()` bump, which db/index.ts forbids) would read as the next
 * version and lock this build out: one more reason never to edit a shipped `version()`.
 */
export function isOlderThanData(storedNative: number | null, verno: number): boolean {
  return storedNative !== null && Math.floor(storedNative / 10) > verno
}

/** How long startup waits for `databases()` before it starts as if the guard did not exist. */
export const DATABASES_TIMEOUT_MS = 1_500

/**
 * The native version of `name` on this device, or null when it does not exist or cannot be read without opening it
 * (`databases()` missing: Firefox before 126; or not answering in time). Unknown is null: the guard lets the app start,
 * as before it existed. Polled every 100 ms like Dexie's own `idbReady`: on Safari a single first call can hang, and
 * startup awaits this, so a hang would be a blank screen (CodeReview).
 */
export function storedVersion(name: string, idb: IDBFactory | undefined = globalThis.indexedDB, timeoutMs = DATABASES_TIMEOUT_MS): Promise<number | null> {
  if (!idb || typeof idb.databases !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: number | null) => {
      if (done) return
      done = true
      clearInterval(retry)
      clearTimeout(giveUp)
      resolve(v)
    }
    const attempt = () => {
      try {
        idb.databases().then((list) => finish(list.find((d) => d.name === name)?.version ?? null), () => finish(null))
      } catch {
        finish(null)
      }
    }
    const retry = setInterval(attempt, 100)
    const giveUp = setTimeout(() => finish(null), timeoutMs)
    attempt()
  })
}
