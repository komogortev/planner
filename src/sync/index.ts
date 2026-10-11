// Browser wiring for the sync engine (H1-ENTRIES §6.4, D-10, D-12): when to run it, and the storage requests that
// belong to being signed in. No Vue here (ARCHITECTURE §3) — `useSyncState` in composables/ adapts it.
import { db } from '@/db'
import { storedToken, API_URL } from '@/auth/signIn'
import { reportError } from '@/log/report'
import { SyncEngine, type SyncState } from './engine'
import { createCycleLock } from './lock'
import { handleTokenStorage } from './tokenWatch'

// One cycle at a time across the app's windows (D-59); no Web Locks API: no lock, the engine runs as it always did.
export const syncEngine = new SyncEngine({
  db, fetch: (...a) => fetch(...a), apiUrl: API_URL, token: storedToken, online: () => navigator.onLine,
  lock: createCycleLock(typeof navigator === 'undefined' ? undefined : navigator.locks),
})

const POLL_MS = 60_000
const AFTER_CAPTURE_MS = 2_000
let started = false
let pollTimer: ReturnType<typeof setInterval> | undefined
let captureTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let persistAsked = false
let teardown: (() => void) | null = null

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Start now: sign-in return, app start, tab visible again, back online, a poll tick — all call this. */
export function syncNow(force = false): void {
  if (!storedToken()) return
  void syncEngine.run({ force })
}

/** A capture just landed: sync soon, not instantly, so a burst of captures is one request. */
export function syncSoon(): void {
  clearTimeout(captureTimer)
  captureTimer = setTimeout(() => syncNow(), AFTER_CAPTURE_MS)
}

function scheduleRetry(s: SyncState): void {
  clearTimeout(retryTimer)
  if (s.phase === 'waiting' && s.retryAt !== null) retryTimer = setTimeout(() => syncNow(), Math.max(0, s.retryAt - Date.now()) + 50) // slack: a timer firing a hair early would find the wait not over
}

/** Ask the browser not to evict the database under storage pressure (H1 §9). Once, after the first good sync. */
function askPersist(s: SyncState): void {
  if (persistAsked || s.lastSyncedAt === null) return
  persistAsked = true
  void navigator.storage?.persist?.().catch(() => undefined)
}

/**
 * Idempotent. Call once the app is mounted. `onSessionChange` hears that ANOTHER window signed in or out (D-59): the app then
 * decides what to show.
 */
export function startSync(opts: { onSessionChange?: (signedIn: boolean) => void } = {}): void {
  if (started) return
  started = true
  let reportedStuck = false
  const unsubscribe = syncEngine.subscribe((s) => {
    scheduleRetry(s); askPersist(s)
    // A sync that keeps failing is reported once per episode, by kind only (no message: it could quote a note).
    if (s.failures >= 3 && !reportedStuck) { reportedStuck = true; void reportError('sync-stuck') }
    if (s.failures === 0) reportedStuck = false
  })
  const onVisible = () => { if (visible()) syncNow() }
  const onOnline = () => syncNow(true) // back online: the wait is over
  const onOffline = () => syncNow() // the cycle notices and says so
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  // The token is shared by every window of the app. When another one changes it, this one must stop acting for the account
  // it was signed in as — `storage` events fire in every window except the one that wrote.
  const onStorage = (e: StorageEvent) =>
    handleTokenStorage(e, { reset: () => syncEngine.reset(), syncNow, signedIn: () => storedToken() !== null, onSessionChange: opts.onSessionChange })
  window.addEventListener('storage', onStorage)
  pollTimer = setInterval(() => { if (visible()) syncNow() }, POLL_MS)
  teardown = () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('storage', onStorage)
  }
  syncNow()
}

export function stopSyncForTests(): void {
  teardown?.()
  teardown = null
  started = false
  clearInterval(pollTimer)
  clearTimeout(captureTimer)
  clearTimeout(retryTimer)
}

export type StorageUsage = { usedBytes: number | null; quotaBytes: number | null; persisted: boolean | null }

/** What the browser says this origin uses (Settings → Storage; the 50 MB eviction trigger reads this). */
export async function storageUsage(): Promise<StorageUsage> {
  try {
    const est = await navigator.storage?.estimate?.()
    return { usedBytes: est?.usage ?? null, quotaBytes: est?.quota ?? null, persisted: (await navigator.storage?.persisted?.()) ?? null }
  } catch {
    return { usedBytes: null, quotaBytes: null, persisted: null }
  }
}
