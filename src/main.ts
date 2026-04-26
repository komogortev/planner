import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useSyncStore } from './stores/sync'
import { setupSyncDirtyTracking } from './db/syncTracking'
import './style.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Wire Dexie hooks → useSyncStore.dirty. Must run AFTER Pinia is installed.
setupSyncDirtyTracking(useSyncStore())

app.mount('#app')
