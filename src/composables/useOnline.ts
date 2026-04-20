import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Reactive `navigator.onLine` for the current window. */
export function useOnline(): Ref<boolean> {
  const online = ref(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  function update(): void {
    if (typeof navigator !== 'undefined') online.value = navigator.onLine
  }

  onMounted(() => {
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    update()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return online
}
