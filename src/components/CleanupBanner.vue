<script setup lang="ts">
import { computed } from 'vue'
import { useCleanupStore } from '@/stores/cleanup'

/**
 * One-shot banner shown once per app boot when `dedupeCategoriesInDb` merged
 * stale duplicate categories left over from the v3 upgrade bug.
 *
 * Dismissable; auto-hidden by default when the cleanup found nothing.
 */
const cleanup = useCleanupStore()

const message = computed(() => {
  const r = cleanup.lastResult
  if (!r || r.mergedGroups === 0) return ''
  const labelPreview =
    r.mergedLabels.length <= 3
      ? r.mergedLabels.join(', ')
      : `${r.mergedLabels.slice(0, 3).join(', ')} +${r.mergedLabels.length - 3} more`
  return `Cleaned up ${r.removedRows} duplicate ${
    r.removedRows === 1 ? 'category row' : 'category rows'
  } across ${r.mergedGroups} ${r.mergedGroups === 1 ? 'label' : 'labels'} (${labelPreview}).`
})
</script>

<template>
  <div
    v-if="cleanup.showBanner"
    class="sticky top-0 z-30 bg-emerald-700 text-white px-4 py-2 text-sm flex items-center justify-between gap-4"
    role="status"
  >
    <span>{{ message }}</span>
    <button
      class="px-3 py-1 rounded-lg hover:bg-white/20 text-xs"
      @click="cleanup.dismiss"
    >
      Dismiss
    </button>
  </div>
</template>
