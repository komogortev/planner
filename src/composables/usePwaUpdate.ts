import { onMounted, ref } from 'vue'

/**
 * Thin wrapper around `virtual:pwa-register` exposing reactive state
 * for a refresh banner. Dynamic import so dev builds without the plugin
 * (or non-PWA previews) degrade gracefully.
 */
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
      })
    } catch {
      // virtual module not available (non-PWA build); silently ignore.
    }
  })

  return { needsRefresh, offlineReady, applyUpdate, dismiss }
}
