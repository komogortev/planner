import { liveQuery, type Subscription } from 'dexie'
import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * Vue composable wrapping Dexie `liveQuery` — reactive Ref<T | undefined> that
 * auto-updates when any Dexie tables touched inside `query` mutate.
 *
 * Example:
 *   const commitments = useLiveQuery(() => db.commitments.toArray(), [])
 */
export function useLiveQuery<T>(query: () => T | Promise<T>, initial: T): Ref<T> {
  const state = ref(initial) as Ref<T>
  const sub: Subscription = liveQuery(query).subscribe({
    next: (value) => {
      state.value = value
    },
    error: (err) => {
      // eslint-disable-next-line no-console
      console.error('[liveQuery] error:', err)
    },
  })
  onScopeDispose(() => sub.unsubscribe())
  return state
}
