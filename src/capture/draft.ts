// The draft: text typed into the capture box and not yet captured (D-56). A deploy reloads the app by itself and a phone
// kills a backgrounded one, so the box would lose what was typed. localStorage, not IndexedDB: it is synchronous, which is
// the only kind of write that is reliable inside `pagehide`. Every access is guarded — blocked or full storage means the
// box works as before, it just cannot remember.
export const DRAFT_KEY = 'planner.capture.draft'
/**
 * Written (JSON, with a value that changes every time) when the draft is cleared on purpose. Another window of the app hears it
 * through the `storage` event — which fires only in OTHER windows — and drops its own copy of the text. Not the removal of
 * DRAFT_KEY: that also happens whenever the owner simply empties the box, and no other window should lose its text for that.
 */
export const CLEARED_KEY = 'planner.capture.draft.cleared'
/** On `window`: the draft was cleared on purpose in THIS window (a capture, or a wipe gesture). */
export const DRAFT_CLEARED = 'planner:draft-cleared'
/** On `window`: write the open box's text to storage now (before something reads the stored draft). */
export const DRAFT_FLUSH = 'planner:draft-flush'

/** A box holding only whitespace has nothing worth remembering — or asking about. */
export const isBlank = (text: string): boolean => text.trim() === ''

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * A blank box removes the draft; anything else is stored exactly as typed. False when storage refused (blocked, full): the
 * caller must not believe the draft is stored, or it would never try again.
 */
export function saveDraft(text: string): boolean {
  try {
    if (isBlank(text)) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, text)
    return true
  } catch {
    return false
  }
}

/** Is there an unsent draft the owner would want to know about? */
export const hasDraft = (): boolean => !isBlank(loadDraft())

function announce(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(name))
}

/**
 * Removes the draft, tells this window's open box to drop its text, and every other window through the marker.
 * `captured` is the text of a note that was just captured: another window then empties its box only if it holds that same
 * text (it may hold something newer). A wipe gesture passes nothing, and takes every window's text.
 */
export function clearDraft(captured?: string): void {
  saveDraft('')
  try {
    localStorage.setItem(CLEARED_KEY, JSON.stringify({ at: `${Date.now()}.${Math.random()}`, ...(captured === undefined ? {} : { text: captured }) }))
  } catch {
    // Storage blocked: no other window can be listening to it either.
  }
  announce(DRAFT_CLEARED)
}

/** Asks this window's open box to write what it holds, so that what is read from storage next is what the owner sees. */
export function flushDrafts(): void {
  announce(DRAFT_FLUSH)
}
