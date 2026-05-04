import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { DedupeCategoriesResult } from '@/db/cleanup'

/**
 * Holds the result of the most recent boot-time `dedupeCategoriesInDb` run so
 * the `CleanupBanner` can surface a one-time toast when dupes were merged.
 *
 * In-memory only. The banner is purely informational; a refresh dismisses it
 * and is fine — the cleanup itself is idempotent and won't fire again unless
 * new dupes appear (which the migration fix prevents).
 */
export const useCleanupStore = defineStore('cleanup', () => {
  const lastResult = ref<DedupeCategoriesResult | null>(null)
  const dismissed = ref(false)

  function record(result: DedupeCategoriesResult): void {
    lastResult.value = result
    dismissed.value = false
  }

  function dismiss(): void {
    dismissed.value = true
  }

  /** Banner is shown when a recent run merged ≥1 group AND user hasn't dismissed. */
  const showBanner = computed(
    () => !dismissed.value && (lastResult.value?.mergedGroups ?? 0) > 0,
  )

  return { lastResult, dismissed, showBanner, record, dismiss }
})
