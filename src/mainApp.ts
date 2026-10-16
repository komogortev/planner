// The app proper (see main.ts for why it is a separate module).
// Must stay the first import: it may rewrite the URL, and the router captures the URL when its module loads.
import './auth/consumeReturn'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { applyEnvCue } from './env/applyEnvCue'
import { applyTheme } from './theme/theme'
import { startSync } from './sync'
import { routeAfterSessionChange } from './sync/tokenWatch'
import { installErrorReporting, reportError } from './log/report'
import { installLiveTextInput } from './composables/liveTextInput'
import { db } from './db'
import { isOlderThanData, storedVersion } from './db/staleBuild'
import StaleBuild from './components/StaleBuild.vue'
import { dropStrandedRuns } from './ai/runWith'
import './style.css'

// Local / preview builds get a coloured banner, tab title, favicon and status bar; prod is untouched.
applyEnvCue()
// Light / dark (Settings → Appearance), applied before mount so the first paint is already in the right theme.
applyTheme()
// Phone keyboards: every v-model updates per keystroke, also mid-word (an Answer button no longer stays disabled).
installLiveTextInput()

function startApp(): void {
  // D-113: a run header with no model call waiting for it can never finish (no reply can be pasted); clear it before any
  // panel reads it.
  dropStrandedRuns()
  const app = createApp(App)

  app.use(createPinia())
  app.use(router)

  app.mount('#app')

  // Sync (H1-ENTRIES section 6.4): at start, when the tab is visible again, when back online, 2 s after a capture and every
  // 60 s. A signed-out device does nothing; capture never waits for any of it.
  startSync({
    // Another window of the app signed out (or in): this one follows, instead of going on as the account it was (D-59).
    onSessionChange: (signedIn) => {
      const to = routeAfterSessionChange(signedIn, router.currentRoute.value.name)
      if (to) void router.push({ name: to })
    },
  })
  installErrorReporting()

  // A6, a window already open: when a newer build upgrades the database from another window, Dexie closes this one with
  // auto-open on, and its next query would reopen downward and patch the newer schema. Stay closed and reload instead, so
  // the reload goes through boot()'s check (CodeReview). Dexie's own handler runs first and closes with auto-open on; this
  // second close turns it off (Dexie.close sets autoOpen = false whenever disableAutoOpen is true).
  db.on('versionchange', () => {
    db.close({ disableAutoOpen: true })
    location.reload()
  })
}

// One report per device per stored version: every Reopen re-runs boot(), and the /log daily cap (A5) is shared.
function reportStaleOnce(stored: number): void {
  const key = 'planner.staleReported'
  try {
    if (localStorage.getItem(key) === String(stored)) return
    localStorage.setItem(key, String(stored))
  } catch {
    // Storage blocked: report anyway; the per-kind throttle in report.ts still holds within this page.
  }
  void reportError('stale-build')
}

// A6 (D-118): a build older than this device's data opens nothing and syncs nothing; it says so and waits for the update.
// Checked before anything can touch the database (src/db/staleBuild.ts says why Dexie alone does not refuse).
async function boot(): Promise<void> {
  const stored = await storedVersion(db.name)
  if (stored !== null && isOlderThanData(stored, db.verno)) {
    createApp(StaleBuild).mount('#app')
    reportStaleOnce(stored)
    return
  }
  startApp()
}
void boot()
