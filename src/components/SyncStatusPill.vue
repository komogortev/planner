<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useSyncStore } from '@/stores/sync'

const settingsStore = useSettingsStore()
const syncStore = useSyncStore()
const router = useRouter()

type PillState = 'hidden' | 'not-synced' | 'unsynced-changes' | 'conflict' | 'error' | 'synced'

const state = computed((): PillState => {
  if (!settingsStore.isConnected) return 'hidden'
  if (syncStore.syncError && syncStore.pendingConflict) return 'conflict'
  if (syncStore.syncError) return 'error'
  if (!settingsStore.settings?.lastSyncedAt) return 'not-synced'
  if (syncStore.dirty) return 'unsynced-changes'
  return 'synced'
})

const label = computed(() => {
  switch (state.value) {
    case 'conflict': return 'Sync conflict'
    case 'error': return 'Sync error — retry'
    case 'not-synced': return 'Not synced yet'
    case 'unsynced-changes': return 'Unsynced changes'
    case 'synced': {
      const at = settingsStore.settings?.lastSyncedAt
      if (!at) return 'Synced'
      const diff = Date.now() - new Date(at).getTime()
      const mins = Math.floor(diff / 60_000)
      if (mins < 1) return 'Synced just now'
      if (mins < 60) return `Synced ${mins}m ago`
      const hrs = Math.floor(mins / 60)
      if (hrs < 24) return `Synced ${hrs}h ago`
      return `Synced ${Math.floor(hrs / 24)}d ago`
    }
    default: return ''
  }
})

const pillClass = computed(() => {
  switch (state.value) {
    case 'conflict':
    case 'error':
      return 'bg-rose-950/60 text-rose-300 border-rose-800 cursor-pointer hover:bg-rose-900/60'
    case 'not-synced':
    case 'unsynced-changes':
      return 'bg-amber-950/60 text-amber-300 border-amber-800'
    case 'synced':
      return 'bg-slate-800/60 text-slate-400 border-slate-700'
    default:
      return ''
  }
})

function onClick() {
  if (state.value === 'conflict' || state.value === 'error') {
    router.push('/settings')
  }
}
</script>

<template>
  <span
    v-if="state !== 'hidden'"
    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
    :class="pillClass"
    @click="onClick"
  >
    {{ label }}
  </span>
</template>
