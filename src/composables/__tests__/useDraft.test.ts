// The Vue wiring of the draft (D-56): the ref, the watcher that saves it, what another window's save and a clear do to it.
// `createDraftBox` is the composable without the component lifecycle, driven here with a fake window and document.
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_KEY } from '@/capture/draft'
import { SAVE_DELAY_MS } from '@/capture/draftSaver'
import { createDraftBox } from '../useDraft'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

class FakeWin extends EventTarget {
  setTimeout = (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number
  clearTimeout = (id: number | undefined) => globalThis.clearTimeout(id)
}
class FakeDoc extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible'
}

beforeEach(() => { store.clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function box() {
  const win = new FakeWin()
  const doc = new FakeDoc()
  const b = createDraftBox(win as never, doc as never)
  b.attach()
  return { win, doc, b }
}

describe('createDraftBox', () => {
  // M: without the watcher the text is never saved at all — only a flush moment would notice.
  it('starts from the stored draft, and saves what is typed once typing pauses', async () => {
    store.set(DRAFT_KEY, 'from last time')
    const { b } = box()
    expect(b.text.value).toBe('from last time')
    b.text.value = 'from last time, plus more'
    await nextTick()
    expect(store.get(DRAFT_KEY)).toBe('from last time') // not yet: the debounce
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    expect(store.get(DRAFT_KEY)).toBe('from last time, plus more')
  })

  it('shows what another window saved, and does not write it back', async () => {
    const { win, b } = box()
    store.set(DRAFT_KEY, 'typed in the other window')
    win.dispatchEvent(Object.assign(new Event('storage'), { key: DRAFT_KEY, newValue: 'typed in the other window' }))
    await nextTick()
    expect(b.text.value).toBe('typed in the other window')
    const spy = vi.spyOn(globalThis.localStorage, 'setItem')
    vi.advanceTimersByTime(10 * SAVE_DELAY_MS)
    expect(spy).not.toHaveBeenCalled()
  })

  it('clear(captured) empties the box and the stored draft', () => {
    store.set(DRAFT_KEY, 'buy milk')
    const { b } = box()
    vi.stubGlobal('window', new FakeWin())
    b.clear('buy milk')
    expect(b.text.value).toBe('')
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  it('a wipe elsewhere empties the box, and a save pending at that moment does not bring the text back', async () => {
    const { win, b } = box()
    b.text.value = 'typed, not yet saved'
    await nextTick()
    vi.stubGlobal('window', win)
    const { clearDraft } = await import('@/capture/draft')
    clearDraft()
    await nextTick()
    vi.advanceTimersByTime(10 * SAVE_DELAY_MS)
    expect(b.text.value).toBe('')
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  it('detach saves what the box holds and stops listening', async () => {
    const { win, b } = box()
    b.text.value = 'left on a route change'
    await nextTick()
    b.detach()
    expect(store.get(DRAFT_KEY)).toBe('left on a route change')
    store.delete(DRAFT_KEY)
    win.dispatchEvent(Object.assign(new Event('storage'), { key: DRAFT_KEY, newValue: 'ignored' }))
    await nextTick()
    expect(b.text.value).toBe('left on a route change')
  })
})
