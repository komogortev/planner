// Two windows of the app on one device (the installed app and a browser tab) share one localStorage. A window's belief
// about what is stored (`persisted`) must follow what the OTHER window does, or text is lost, the sign-out guard stops
// matching what the owner sees, and a refusal cannot be cleared. The "browser" below forwards each window's storage writes to
// the other windows as `storage` events, the way a real one does (the writer itself is never told).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, CLEARED_KEY, DRAFT_FLUSH, DRAFT_KEY, hasDraft } from '../draft'
import { createDraftSaver } from '../draftSaver'

const store = new Map<string, string>()
let pending: { key: string; newValue: string | null }[] = []
let failWrites = 0
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { if (failWrites > 0) { failWrites--; throw new Error('quota') } store.set(k, v); pending.push({ key: k, newValue: v }) },
    removeItem: (k: string) => { if (failWrites > 0) { failWrites--; throw new Error('quota') } if (store.delete(k)) pending.push({ key: k, newValue: null }) },
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

type W = ReturnType<typeof windowOf>
const windows: W[] = []

function windowOf() {
  const win = new FakeWin()
  const doc = new FakeDoc()
  const box = { text: store.get(DRAFT_KEY) ?? '', cleared: 0, adopted: [] as string[] }
  const saver = createDraftSaver({
    getText: () => box.text,
    onCleared: () => { box.text = ''; box.cleared++ },
    onAdopt: (t) => { box.text = t; box.adopted.push(t) },
    win: win as never,
    doc: doc as never,
  })
  saver.attach()
  const w = { win, doc, box, saver }
  windows.push(w)
  return w
}

/** Run something as ONE window: whatever it writes to storage is announced to every other window afterwards. */
function act(who: W, fn: () => void): void {
  pending = []
  fn()
  const sent = pending
  pending = []
  for (const other of windows) {
    if (other === who) continue
    for (const p of sent) other.win.dispatchEvent(Object.assign(new Event('storage'), p))
  }
}
const type = (w: W, text: string) => { w.box.text = text; w.saver.touch() }
const hide = (w: W) => act(w, () => { w.doc.visibilityState = 'hidden'; w.doc.dispatchEvent(new Event('visibilitychange')) })
const saveNow = (w: W) => act(w, () => w.saver.flush())
/** What the capture key does in a window: capture `text`, empty the box, clear the draft (everywhere). */
const capture = (w: W, text: string) => act(w, () => { vi.stubGlobal('window', w.win); try { w.box.text = ''; clearDraft(text) } finally { vi.unstubAllGlobals() } })
/** What a wipe gesture (sign-out, Clear this device) does: clear the draft with no captured text. */
const wipe = (w: W) => act(w, () => { vi.stubGlobal('window', w.win); try { clearDraft() } finally { vi.unstubAllGlobals() } })

beforeEach(() => { store.clear(); pending = []; windows.length = 0; failWrites = 0; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('a window follows what another window saved', () => {
  // Review finding: A still shows "T" after B emptied the stored draft; A's flush then skipped (it believed "T" was stored),
  // so hasDraft() read empty, sign-out went ahead and destroyed text the owner could see.
  it('text this window shows is still protected after another window emptied the stored draft', () => {
    store.set(DRAFT_KEY, 'T')
    const a = windowOf()
    const b = windowOf()
    b.box.text = ''
    saveNow(b) // B removes the stored draft; A hears it
    expect(a.box.text).toBe('T') // A keeps what its owner can see
    a.win.dispatchEvent(new Event(DRAFT_FLUSH)) // sign-out asks the open box to write before it reads
    expect(store.get(DRAFT_KEY)).toBe('T')
    expect(hasDraft()).toBe(true)
  })

  // Review finding: a stored draft the window does not show could block sign-out with no way to clear it.
  it('a window with an empty box shows what another window saved, and writes nothing for it', () => {
    const a = windowOf()
    const b = windowOf()
    type(b, 'typed in the tab')
    hide(b)
    expect(a.box.text).toBe('typed in the tab')
    expect(a.box.adopted).toEqual(['typed in the tab'])
    const before = store.get(DRAFT_KEY)
    hide(a)
    a.saver.detach()
    expect(store.get(DRAFT_KEY)).toBe(before) // adopting is not an edit: nothing written back
  })

  it('a window with edits of its own keeps them, and they win on its next save', () => {
    store.set(DRAFT_KEY, 'old')
    const a = windowOf()
    const b = windowOf()
    type(a, 'old, edited in A') // not saved yet
    type(b, 'old, edited in B')
    saveNow(b)
    expect(a.box.text).toBe('old, edited in A')
    expect(a.box.adopted).toEqual([])
    saveNow(a)
    expect(store.get(DRAFT_KEY)).toBe('old, edited in A')
  })

  it('another window blanking the draft by hand does not blank this box, and this box re-saves', () => {
    store.set(DRAFT_KEY, 'T')
    const a = windowOf()
    const b = windowOf()
    b.box.text = ''
    saveNow(b)
    expect(a.box.text).toBe('T')
    hide(a)
    expect(store.get(DRAFT_KEY)).toBe('T')
  })
})

describe('a capture or a wipe in one window', () => {
  // Review finding: a capture in A emptied B's box and storage even when B held newer text.
  it('a capture empties another window only when it holds the text that was captured', () => {
    store.set(DRAFT_KEY, 'buy milk')
    const a = windowOf()
    const b = windowOf()
    type(b, 'buy milk and eggs')
    saveNow(b)
    expect(a.box.text).toBe('buy milk and eggs') // A adopted it, so A captures the full text
    capture(a, 'buy milk and eggs')
    expect(b.box.text).toBe('')
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  it('…and keeps its own text when it holds something else', () => {
    store.set(DRAFT_KEY, 'buy milk')
    const a = windowOf()
    const b = windowOf()
    type(a, 'buy milk!') // an edit in A that B has not seen
    type(b, 'buy milk and eggs')
    saveNow(b)
    expect(a.box.text).toBe('buy milk!')
    capture(a, 'buy milk!') // A captures its own text
    expect(b.box.text).toBe('buy milk and eggs') // B's newer text is not wiped
    hide(b)
    expect(store.get(DRAFT_KEY)).toBe('buy milk and eggs') // and survives in storage
  })

  // Negative control: a wipe gesture is not a capture — it takes the text whatever the other window holds.
  it('a wipe gesture empties every window, whatever it holds', () => {
    store.set(DRAFT_KEY, 'T')
    const a = windowOf()
    const b = windowOf()
    type(b, 'something newer')
    wipe(a)
    expect(b.box.text).toBe('')
    b.saver.detach()
    b.win.dispatchEvent(new Event('pagehide'))
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  // The line `persisted = ''` in the clear: without it B believes the old text is stored and removes A's NEW draft.
  it('a window that cleared its text does not remove a draft saved after the clear', () => {
    store.set(DRAFT_KEY, 'T')
    const a = windowOf()
    const b = windowOf()
    wipe(a)
    type(a, 'next thought')
    saveNow(a)
    expect(store.get(DRAFT_KEY)).toBe('next thought')
    hide(b) // B's box was emptied by the clear; it must not touch storage
    expect(store.get(DRAFT_KEY)).toBe('next thought')
  })

  // Events reach a window one after another and in no promised order: B may hear the clear before it hears that A has
  // already saved a new draft. B's own belief must then already say "nothing stored", or its next flush removes A's text.
  it('the clear alone, before any other event arrives, leaves the window believing nothing is stored', () => {
    store.set(DRAFT_KEY, 'T')
    const b = windowOf()
    store.set(DRAFT_KEY, 'saved by A right after the clear') // B has not heard about this write yet
    b.win.dispatchEvent(Object.assign(new Event('storage'), { key: CLEARED_KEY, newValue: JSON.stringify({ at: '1' }) }))
    expect(b.box.text).toBe('')
    hide(b)
    expect(store.get(DRAFT_KEY)).toBe('saved by A right after the clear')
  })

  it('storage events about other keys do nothing', () => {
    const a = windowOf()
    type(a, 'keep me')
    a.win.dispatchEvent(Object.assign(new Event('storage'), { key: 'something.else', newValue: 'x' }))
    a.win.dispatchEvent(Object.assign(new Event('storage'), { key: null, newValue: null })) // localStorage.clear()
    expect(a.box.text).toBe('keep me')
    expect(a.box.cleared).toBe(0)
  })

  it('a marker that is not understood is treated as a wipe, not ignored', () => {
    store.set(DRAFT_KEY, 'T')
    const a = windowOf()
    a.win.dispatchEvent(Object.assign(new Event('storage'), { key: CLEARED_KEY, newValue: 'not json' }))
    expect(a.box.text).toBe('')
  })
})

describe('a save that failed is tried again', () => {
  // Review finding: `persisted` advanced although the write failed, so the same text was never retried.
  it('storage full on the first save; the next flush writes it', () => {
    const a = windowOf()
    type(a, 'buy milk')
    failWrites = 1
    a.saver.flush()
    expect(store.has(DRAFT_KEY)).toBe(false)
    a.saver.flush()
    expect(store.get(DRAFT_KEY)).toBe('buy milk')
  })
})
