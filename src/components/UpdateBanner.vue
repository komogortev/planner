<script setup lang="ts">
import { usePwaUpdate } from '@/composables/usePwaUpdate'

const { needsRefresh, applyUpdate, dismiss } = usePwaUpdate()
</script>

<template>
  <div
    v-if="needsRefresh"
    class="sticky top-0 z-30 bg-indigo-600 text-white px-4 py-2 text-sm flex items-center justify-between gap-4"
    role="status"
  >
    <span>A new version is available.</span>
    <div class="flex items-center gap-2">
      <button
        class="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 font-semibold text-xs"
        @click="applyUpdate"
      >
        Reload
      </button>
      <button
        class="px-3 py-1 rounded-lg hover:bg-white/20 text-xs"
        @click="dismiss"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>
