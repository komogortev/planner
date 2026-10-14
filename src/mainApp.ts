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
import { installErrorReporting } from './log/report'
import { installLiveTextInput } from './composables/liveTextInput'
import './style.css'

// Local / preview builds get a coloured banner, tab title, favicon and status bar; prod is untouched.
applyEnvCue()
// Light / dark (Settings → Appearance), applied before mount so the first paint is already in the right theme.
applyTheme()
// Phone keyboards: every v-model updates per keystroke, also mid-word (an Answer button no longer stays disabled).
installLiveTextInput()

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
