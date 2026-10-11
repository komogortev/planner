// The "moved" build's entry: one screen, nothing else. It starts no sync, installs no router and seeds nothing — a device
// that still holds notes must not write to them or to the server from the old address (docs/ORIGIN-MOVE.md phase 4).
import { createApp } from 'vue'
import MovedApp from './MovedApp.vue'
import { applyTheme } from '@/theme/theme'
import '../style.css'

applyTheme()
createApp(MovedApp, { to: import.meta.env.VITE_MOVED_TO as string }).mount('#app')
