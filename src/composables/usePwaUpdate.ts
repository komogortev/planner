import { onMounted, ref } from 'vue'

/**
 * Thin wrapper around `virtual:pwa-register` exposing reactive state
 * for a refresh banner. Dynamic import so dev builds without the plugin
 * (or non-PWA previews) degrade gracefully.
 */
/** How often an app left open looks for a new build. */
export const UPDATE_EVERY_MS = 30 * 60_000

/**
 * The browser looks for a new service worker only on a navigation. An installed app brought back from the background
 * resumes the old page and never navigates, so the phone kept running an old build for hours (owner, 2026-10-13). Look
 * again each time the app comes to the front, and every half hour while it stays open. `autoUpdate` reloads into the new
 * build once it is installed; the capture draft survives a reload (useDraft).
 */
export function watchForUpdates(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  env: { doc: Pick<Document, 'addEventListener' | 'visibilityState'>; online: () => boolean; every: (fn: () => void, ms: number) => unknown } = {
    doc: document,
    online: () => navigator.onLine,
    every: (fn, ms) => setInterval(fn, ms),
  },
): () => void {
  const check = () => {
    if (env.doc.visibilityState !== 'visible' || !env.online()) return
    registration.update().catch(() => {}) // offline or the server hiccupped: the next check tries again
  }
  env.doc.addEventListener('visibilitychange', check)
  env.every(check, UPDATE_EVERY_MS)
  return check
}

export function usePwaUpdate() {
  const needsRefresh = ref(false)
  const offlineReady = ref(false)
  let updateFn: ((reload?: boolean) => Promise<void>) | null = null

  async function applyUpdate(): Promise<void> {
    if (updateFn) {
      await updateFn(true)
    } else if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  function dismiss(): void {
    needsRefresh.value = false
  }

  onMounted(async () => {
    try {
      const mod = await import('virtual:pwa-register')
      updateFn = mod.registerSW({
        immediate: true,
        onNeedRefresh() {
          needsRefresh.value = true
        },
        onOfflineReady() {
          offlineReady.value = true
        },
        onRegisteredSW(_url, registration) {
          if (registration) watchForUpdates(registration)
        },
      })
    } catch {
      // virtual module not available (non-PWA build); silently ignore.
    }
  })

  return { needsRefresh, offlineReady, applyUpdate, dismiss }
}
