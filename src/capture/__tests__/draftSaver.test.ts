// When the capture box's text is saved, and when it lets go of it (D-56). Driven with a fake window and document and fake
// timers, so every moment a deploy reload, a phone switching apps or a second window passes through is exercised.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, CLEARED_KEY, DRAFT_FLUSH, DRAFT_KEY, loadDraft } from '../draft'
import { createDraftSaver, SAVE_DELAY_MS } from '../draftSaver'

const store = new Map<string, string>()
let writes: string[] = []
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(`set ${k}`); store.set(k, v) },
    removeItem: (k: string) => { writes.push(`remove ${k}`); store.delete(k) },
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

/** One window of the app: a text, a saver around it. */
function windowOf(initial = loadDraft()) {
  const win = new FakeWin()
  const doc = new FakeDoc()
  const box = { text: initial, cleared: 0 }
  // `onCleared` only empties the box, as the real one does: the Vue watcher that follows is asynchronous, so a save that was
  // pending when the clear came must be cancelled by the saver itself, not by a lucky `touch` here.
  const saver = createDraftSaver({ getText: () => box.text, onCleared: () => { box.text = ''; box.cleared++ }, onAdopt: (t) => { box.text = t }, win: win as never, doc: doc as never })
  saver.attach()
  const type = (t: string) => { box.text = t; saver.touch() }
  const hide = () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) }
  return { win, doc, box, saver, type, hide }
}

beforeEach(() => { store.clear(); writes = []; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('saving', () => {
  // Known positive: text typed and left alone is saved, so the "nothing saved" cases below cannot pass on a dead saver.
  it('saves once typing pauses, not on every keystroke', () => {
    const w = windowOf()
    w.type('b'); w.type('bu'); w.type('buy milk')
    expect(store.has(DRAFT_KEY)).toBe(false)
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1)
    expect(store.has(DRAFT_KEY)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(store.get(DRAFT_KEY)).toBe('buy milk')
    expect(writes).toEqual([`set ${DRAFT_KEY}`])
  })

  // The reload itself: a deploy swaps the service worker and the page is reloaded inside the debounce window.
  it('saves at once when the page is unloading (pagehide)', () => {
    const w = windowOf()
    w.type('typed a moment before the reload')
    w.win.dispatchEvent(new Event('pagehide'))
    expect(store.get(DRAFT_KEY)).toBe('typed a moment before the reload')
  })

  it('saves at once when the page is hidden (a phone switching apps), and not when it becomes visible', () => {
    const w = windowOf()
    w.type('half a thought')
    w.hide()
    expect(store.get(DRAFT_KEY)).toBe('half a thought')
    w.type('half a thought, more')
    w.doc.visibilityState = 'visible'
    w.doc.dispatchEvent(new Event('visibilitychange'))
    expect(store.get(DRAFT_KEY)).toBe('half a thought') // visible is not a save point
  })

  it('saves what the box holds when the page unmounts (detach), and stops listening', () => {
    const w = windowOf()
    w.type('left behind on a route change')
    w.saver.detach()
    expect(store.get(DRAFT_KEY)).toBe('left behind on a route change')
    w.type('typed after detach')
    w.win.dispatchEvent(new Event('pagehide'))
    expect(store.get(DRAFT_KEY)).toBe('left behind on a route change')
  })

  it('a flush request (something is about to read the stored draft) writes what the box holds', () => {
    const w = windowOf()
    w.type('just typed')
    w.win.dispatchEvent(new Event(DRAFT_FLUSH)) // what flushDrafts() sends: something is about to read the stored draft
    expect(store.get(DRAFT_KEY)).toBe('just typed')
  })

  it('the text on load is the stored draft, and loading writes nothing', () => {
    store.set(DRAFT_KEY, 'from last time')
    const w = windowOf()
    expect(w.box.text).toBe('from last time')
    w.hide()
    expect(writes).toEqual([])
  })
})

describe('clearing on purpose', () => {
  // M1: without the handler the unmount flush writes the text straight back after a sign-out cleared it.
  it('a clear in this window empties the box, and nothing writes the text back afterwards', () => {
    const w = windowOf()
    w.type('typed, then the owner signs out')
    w.win.dispatchEvent(new Event('pagehide')) // saved
    vi.stubGlobal('window', w.win)
    clearDraft()
    expect(store.has(DRAFT_KEY)).toBe(false)
    expect(w.box.text).toBe('')
    expect(w.box.cleared).toBe(1)
    w.saver.detach() // the page unmounts after the route change
    w.win.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersByTime(10 * SAVE_DELAY_MS)
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  it('a save that was still pending when the clear came does not write the old text', () => {
    const w = windowOf()
    w.type('typed and not yet saved')
    vi.stubGlobal('window', w.win)
    clearDraft()
    vi.advanceTimersByTime(10 * SAVE_DELAY_MS)
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  it('a clear in ANOTHER window (the marker, heard as a storage event) empties this box too', () => {
    const b = windowOf()
    b.type('held in the second window')
    b.hide() // saved
    // window A signs out: it removes the draft and writes the marker; the browser tells B
    store.delete(DRAFT_KEY)
    store.set(CLEARED_KEY, 'x')
    b.win.dispatchEvent(Object.assign(new Event('storage'), { key: CLEARED_KEY }))
    expect(b.box.text).toBe('')
    b.saver.detach()
    b.win.dispatchEvent(new Event('pagehide'))
    expect(store.has(DRAFT_KEY)).toBe(false) // the sign-out leak: the next account must not find it
  })

  // Negative controls: other keys, and the owner simply emptying their box in another window, are not a wipe.
  it('a storage event for another key does nothing', () => {
    const b = windowOf()
    b.type('keep me')
    b.win.dispatchEvent(Object.assign(new Event('storage'), { key: 'something.else' }))
    b.win.dispatchEvent(Object.assign(new Event('storage'), { key: DRAFT_KEY, newValue: null }))
    expect(b.box.text).toBe('keep me')
    expect(b.box.cleared).toBe(0)
  })
})

describe('two windows (an installed app and a browser tab)', () => {
  // A window that never typed must not remove what the other one saved.
  it('a pristine window that hides or closes leaves another window\'s draft alone', () => {
    const a = windowOf('')
    const b = windowOf('') // both opened with no draft
    a.type('typed in A')
    a.hide()
    expect(store.get(DRAFT_KEY)).toBe('typed in A')
    b.hide()
    b.saver.detach()
    b.win.dispatchEvent(new Event('pagehide'))
    expect(store.get(DRAFT_KEY)).toBe('typed in A')
  })

  // A window that already saved its text must not save it again after the other one captured it and cleared the draft.
  it('a window that loaded the draft does not write it back after the other window captured it', () => {
    store.set(DRAFT_KEY, 'same text in both')
    const a = windowOf()
    const b = windowOf()
    // A captures it: the box empties, the stored draft is cleared (marker + event on A, storage event on B)
    vi.stubGlobal('window', a.win)
    a.box.text = ''
    clearDraft()
    b.win.dispatchEvent(Object.assign(new Event('storage'), { key: CLEARED_KEY }))
    b.hide()
    b.saver.detach()
    expect(store.has(DRAFT_KEY)).toBe(false)
    expect(b.box.text).toBe('')
  })

  it('a window that has not changed its text writes nothing at all', () => {
    store.set(DRAFT_KEY, 'unchanged')
    const w = windowOf()
    w.hide()
    w.saver.detach()
    w.win.dispatchEvent(new Event('pagehide'))
    expect(writes).toEqual([])
  })
})
