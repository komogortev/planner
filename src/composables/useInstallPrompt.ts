import { onBeforeUnmount, onMounted, ref, computed } from 'vue'

/**
 * PWA install-prompt state machine.
 *
 * Chromium (Edge/Chrome desktop, Chrome Android): fires `beforeinstallprompt`
 * when install criteria are met. We capture the event and let the user trigger
 * the native install dialog from a button in the UI.
 *
 * iOS Safari: never fires `beforeinstallprompt`. We detect iOS and surface
 * manual instructions ("Share → Add to Home Screen") instead.
 *
 * Already installed: detected via the `display-mode: standalone` media query
 * (Chromium + iOS PWA on home screen) and `navigator.standalone` (iOS Safari
 * legacy). When standalone, the button hides itself.
 *
 * No dismissal (owner, 2026-10-14): installing stays available until the app is installed. A device that hid the
 * button with the old "×" kept a localStorage flag; it is cleared on mount so the button comes back there too.
 */

const LEGACY_DISMISS_KEY = 'pp.installPrompt.dismissed'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

export function useInstallPrompt() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
  const isStandalone = ref(false)
  const isIOS = ref(false)
  const lastOutcome = ref<'accepted' | 'dismissed' | null>(null)

  /** Chromium can install: we have the captured event. */
  const canInstall = computed(() => deferredPrompt.value !== null)

  /** iOS path: show manual instructions. Only when not already installed. */
  const showIOSHint = computed(() => isIOS.value && !isStandalone.value)

  /** Anything to show at all. */
  const visible = computed(() => !isStandalone.value && (canInstall.value || isIOS.value))

  function detectPlatform() {
    if (typeof window === 'undefined') return
    isStandalone.value =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Safari legacy
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true
    const ua = window.navigator.userAgent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isIOS.value = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
    try { window.localStorage.removeItem(LEGACY_DISMISS_KEY) } catch { /* storage blocked: nothing to clear */ }
  }

  function onBeforeInstallPrompt(e: Event) {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
  }

  function onAppInstalled() {
    deferredPrompt.value = null
    isStandalone.value = true
    lastOutcome.value = 'accepted'
  }

  async function prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const evt = deferredPrompt.value
    if (!evt) return 'unavailable'
    await evt.prompt()
    const choice = await evt.userChoice
    lastOutcome.value = choice.outcome
    deferredPrompt.value = null
    return choice.outcome
  }

  onMounted(() => {
    detectPlatform()
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onAppInstalled)
  })

  return {
    canInstall,
    showIOSHint,
    visible,
    isStandalone,
    isIOS,
    lastOutcome,
    prompt,
  }
}
