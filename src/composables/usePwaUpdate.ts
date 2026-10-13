import { onMounted, ref } from 'vue'

/**
 * Thin wrapper around `virtual:pwa-register` exposing reactive state
 * for a refresh banner. Dynamic import so dev builds without the plugin
 * (or non-PWA previews) degrade gracefully.
 */
/**
 * The browser looks for a new service worker only on a navigation. An installed app brought back from the background
 * resumes the old page and never navigates, so the phone kept running an old build for hours (owner, 2026-10-13). So the
 * app looks each time it goes to the BACKGROUND: the new build installs while he is away, and `autoUpdate` reloads into
 * it the moment he is back, before he types. Not on return and not on a timer: under `autoUpdate` a check while he is
 * using the app reloads it seconds later and drops whatever he is typing (only the capture draft survives a reload;
 * an answer or a pasted reply does not). Cost: a deploy reaches the phone one leave-and-return later. Mounted once
 * (UpdateBanner in App.vue); nothing to tear down.
 */
export function watchForUpdates(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  env: { doc: Pick<Document, 'addEventListener' | 'visibilityState'>; online: () => boolean } = { doc: document, online: () => navigator.onLine },
): void {
  env.doc.addEventListener('visibilitychange', () => {
    if (env.doc.visibilityState !== 'hidden' || !env.online()) return
    try {
      registration.update().catch(() => {}) // offline or the server hiccupped: the next leave tries again
    } catch {
      // a browser that throws instead of rejecting: same
    }
  })
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
