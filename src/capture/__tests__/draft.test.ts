// The draft: text typed into the capture box and not yet captured. It must survive a reload (a deploy reloads the app
// by itself, and a phone kills a backgrounded app), so it lives in localStorage — synchronous, which is the one
// storage that is still reliable inside `pagehide`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, CLEARED_KEY, DRAFT_CLEARED, DRAFT_FLUSH, DRAFT_KEY, flushDrafts, hasDraft, isBlank, loadDraft, saveDraft } from '../draft'

const store = new Map<string, string>()
let blocked = false
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => { if (blocked) throw new Error('blocked'); return store.get(k) ?? null },
    setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); store.set(k, v) },
    removeItem: (k: string) => { if (blocked) throw new Error('blocked'); store.delete(k) },
  },
  configurable: true,
})

beforeEach(() => { store.clear(); blocked = false })
afterEach(() => vi.unstubAllGlobals())

describe('draft', () => {
  // Known positive: what is saved really comes back, so the "empty" cases below cannot pass on a store that drops everything.
  it('what was saved is what loads', () => {
    saveDraft('half a thought\nwith a second line')
    expect(store.get(DRAFT_KEY)).toBe('half a thought\nwith a second line')
    expect(loadDraft()).toBe('half a thought\nwith a second line')
  })

  it('nothing saved loads as an empty box', () => {
    expect(loadDraft()).toBe('')
  })

  it('a blank box removes the draft instead of storing it', () => {
    saveDraft('something')
    saveDraft('')
    expect(store.has(DRAFT_KEY)).toBe(false)
    saveDraft('something')
    saveDraft(' \n\t ')
    expect(store.has(DRAFT_KEY)).toBe(false)
  })

  it('whitespace around real text is kept exactly (the owner\'s text is never rewritten)', () => {
    saveDraft('  indented\n\n')
    expect(loadDraft()).toBe('  indented\n\n')
  })

  it('hasDraft is false for nothing and for blank text, true for text', () => {
    expect(hasDraft()).toBe(false)
    store.set(DRAFT_KEY, ' \n ') // as an older build or another tool might have left it
    expect(isBlank(loadDraft())).toBe(true)
    expect(hasDraft()).toBe(false)
    saveDraft('x')
    expect(hasDraft()).toBe(true)
  })

  // Storage can be blocked or full: the box must still work, it just cannot remember.
  it('blocked storage never throws', () => {
    blocked = true
    expect(() => saveDraft('x')).not.toThrow()
    expect(() => clearDraft()).not.toThrow()
    expect(() => flushDrafts()).not.toThrow()
    expect(loadDraft()).toBe('')
    expect(hasDraft()).toBe(false)
  })
})

describe('clearDraft tells open boxes', () => {
  it('removes the draft, dispatches DRAFT_CLEARED on this window, and leaves a marker the other windows hear', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    let n = 0
    target.addEventListener(DRAFT_CLEARED, () => n++)
    saveDraft('x')
    clearDraft()
    expect(n).toBe(1)
    expect(store.has(DRAFT_KEY)).toBe(false)
    expect(store.get(CLEARED_KEY)).toBeTruthy()
  })

  // A same-value setItem fires no `storage` event, so two clears in a row must write two different markers.
  it('the marker changes on every clear', () => {
    clearDraft()
    const first = store.get(CLEARED_KEY)
    clearDraft()
    expect(store.get(CLEARED_KEY)).not.toBe(first)
  })

  // Negative control: typing the box empty is not a wipe — no other window may lose its text for it.
  it('saving a blank box announces nothing and writes no marker', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    let n = 0
    target.addEventListener(DRAFT_CLEARED, () => n++)
    saveDraft('x')
    saveDraft('')
    expect(n).toBe(0)
    expect(store.has(CLEARED_KEY)).toBe(false)
  })

  it('flushDrafts asks the open box to write what it holds', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    let n = 0
    target.addEventListener(DRAFT_FLUSH, () => n++)
    flushDrafts()
    expect(n).toBe(1)
  })
})
