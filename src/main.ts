import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useSyncStore } from './stores/sync'
import { useCategoriesStore } from './stores/categories'
import { setupSyncDirtyTracking } from './db/syncTracking'
import './style.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Wire Dexie hooks → useSyncStore.dirty. Must run AFTER Pinia is installed.
setupSyncDirtyTracking(useSyncStore())

// Ensure built-in L2 categories exist on first run.
//
// Dexie only fires version().upgrade() callbacks when an EXISTING database is
// being upgraded — fresh installs skip straight to the highest declared
// version, so the v2→v3 seed code in `db/index.ts` never runs for new devices.
// `ensureBuiltIns` is idempotent (bulkGet check) so calling it always is safe
// for upgraded devices too. Fire-and-forget; failures here are non-fatal and
// the user can re-seed via Settings → "Load sample data".
useCategoriesStore()
  .ensureBuiltIns()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[main] failed to ensure built-in categories:', err)
  })

app.mount('#app')
