import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { useLiveQuery } from '@/composables/useLiveQuery'
import type { HarnessData2 } from '@/domain/harness2'
import type { Task } from '@/domain/tasks'
import { harnessWork, loadHarnessData2, today } from './loop2'
import { stripItems, type StripItem } from './queue2'

const EMPTY: HarnessData2 = { entries: [], assessments: [], questions: [], tasks: [], proposals: [], states: [] }

export interface Loop2 {
  data: Ref<HarnessData2>
  now: Ref<string>
  day: ComputedRef<{ day: string; tasks: Task[]; upcoming: Task[] }>
  items: ComputedRef<StripItem[]>
  work: ComputedRef<{ notes: number; tasks: number }>
}

/** The account's notes, Tasks, questions and proposals, live (one subscription for the whole Dashboard). Views that depend
 *  on "today" compute from `now`, which ticks every minute, so Daily rolls over at midnight without waiting for a table to
 *  change. */
export function useLoop2(): Loop2 {
  const data = useLiveQuery(loadHarnessData2, EMPTY)
  const now = ref(new Date().toISOString())
  const tick = () => (now.value = new Date().toISOString())
  const timer = window.setInterval(tick, 60_000)
  // A backgrounded phone app may not run timers: coming back is when "today" most often has moved on.
  const onVisible = () => document.visibilityState === 'visible' && tick()
  document.addEventListener('visibilitychange', onVisible)
  onScopeDispose(() => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  })
  return {
    data,
    now,
    day: computed(() => today(data.value, now.value)),
    items: computed(() => stripItems(data.value)),
    work: computed(() => harnessWork(data.value, now.value)),
  }
}
