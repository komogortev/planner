import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearDraft, loadDraft } from '@/capture/draft'
import { createDraftSaver } from '@/capture/draftSaver'

/**
 * The capture box's text, remembered across a reload and shared with the app's other windows (D-56). The rules — when it is
 * saved, when it is dropped, what another window did — live in `createDraftSaver`; this is the ref around it, with the window
 * and document passed in so a test can drive it. Not tied to a component: `useDraft` adds the lifecycle.
 */
export function createDraftBox(win: Parameters<typeof createDraftSaver>[0]['win'], doc: Parameters<typeof createDraftSaver>[0]['doc']) {
  const text = ref(loadDraft())
  const saver = createDraftSaver({ getText: () => text.value, onCleared: () => { text.value = '' }, onAdopt: (t) => { text.value = t }, win, doc })
  watch(text, () => saver.touch())

  /** The note was captured and the box is empty: the stored draft is done with, here and (when they hold the same text) elsewhere. */
  function clear(captured?: string): void {
    text.value = ''
    clearDraft(captured)
  }

  return { text, clear, flush: saver.flush, attach: saver.attach, detach: saver.detach }
}

export function useDraft() {
  const box = createDraftBox(window, document)
  onMounted(box.attach)
  onBeforeUnmount(box.detach)
  return box
}
