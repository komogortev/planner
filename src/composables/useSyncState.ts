import { onScopeDispose, readonly, ref, type Ref } from 'vue'
import { syncEngine } from '@/sync'
import type { SyncState } from '@/sync/engine'

/** The sync engine's state as a Vue ref (the engine itself imports no Vue). */
export function useSyncState(): Readonly<Ref<SyncState>> {
  const state = ref(syncEngine.state) as Ref<SyncState>
  const off = syncEngine.subscribe((s) => { state.value = s })
  onScopeDispose(off)
  return readonly(state) as Readonly<Ref<SyncState>>
}
