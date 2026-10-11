// When the capture box's text is saved, and when it lets go of it (D-56). Plain TypeScript with the window and document
// passed in: the Vue wrapper (`useDraft`) is only a ref around it, and this is what the tests drive.
//
// Two windows of the app on one device (the installed app and a browser tab) share one localStorage. Each keeps `persisted`,
// its belief about what is stored; it is corrected by every write this window makes AND by what the other window does, which
// it hears as `storage` events (the browser tells every window but the writer). A window that did not edit adopts what the
// other saved; one that did edit keeps its own text and wins on its next save; and a capture or a wipe in one window empties
// another only when that is right (see `onStorage`).
import { CLEARED_KEY, DRAFT_CLEARED, DRAFT_FLUSH, DRAFT_KEY, isBlank, loadDraft, saveDraft } from './draft'

export const SAVE_DELAY_MS = 250

type Win = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>
type Doc = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>

export interface DraftSaverOptions {
  getText: () => string
  /** The draft was cleared on purpose elsewhere (a wipe, a capture in another window): empty the box too. */
  onCleared: () => void
  /** Another window saved a draft and this box had no edits of its own: show it. */
  onAdopt: (text: string) => void
  win: Win
  doc: Doc
}

/** What storage holds for a text: a blank box is stored as nothing. */
const stored = (text: string): string => (isBlank(text) ? '' : text)

export function createDraftSaver(o: DraftSaverOptions) {
  let timer: number | undefined
  // What this window believes storage holds. A write happens only when the text differs from it — so a window that never
  // typed, or one that already saved, cannot overwrite (or remove) what ANOTHER window saved since.
  let persisted = stored(loadDraft())

  const flush = (): void => {
    o.win.clearTimeout(timer)
    const text = stored(o.getText())
    if (text === persisted) return
    // Believed stored only if storage took it: a refused write (full, blocked) is tried again on the next flush.
    if (saveDraft(text)) persisted = text
  }
  /** The text changed: save it once typing pauses. */
  const touch = (): void => {
    o.win.clearTimeout(timer)
    timer = o.win.setTimeout(flush, SAVE_DELAY_MS)
  }
  const cleared = (): void => {
    o.win.clearTimeout(timer) // a pending save must not write the text back
    persisted = ''
    o.onCleared()
  }
  const onHidden = (): void => { if (o.doc.visibilityState === 'hidden') flush() }

  const onStorage = (e: Event): void => {
    const { key, newValue } = e as StorageEvent
    if (key === CLEARED_KEY) {
      // A capture names the text it took; a wipe names nothing (and so does anything this build cannot read).
      let captured: string | undefined
      try {
        const marker = JSON.parse(newValue ?? '') as { text?: unknown }
        if (typeof marker.text === 'string') captured = marker.text
      } catch { /* not a marker this build wrote: treat it as a wipe */ }
      if (captured !== undefined && stored(o.getText()) !== stored(captured)) {
        // A note was captured in another window, but THIS box holds something else (newer text): keep it, and say storage is
        // empty so the next save puts it back.
        persisted = ''
        touch()
        return
      }
      cleared()
      return
    }
    if (key === DRAFT_KEY) {
      const mine = stored(o.getText())
      const hadEdits = mine !== persisted
      persisted = stored(newValue ?? '') // what storage holds now, whoever wrote it
      // No edits of my own and the other window saved something: show it. (If it emptied the draft instead, I keep my
      // text — no window loses its text because another one was emptied by hand — and my next save puts it back.)
      if (!hadEdits && persisted !== '' && persisted !== mine) {
        o.win.clearTimeout(timer)
        o.onAdopt(persisted)
      }
    }
  }

  function attach(): void {
    o.doc.addEventListener('visibilitychange', onHidden)
    o.win.addEventListener('pagehide', flush)
    o.win.addEventListener(DRAFT_FLUSH, flush)
    o.win.addEventListener(DRAFT_CLEARED, cleared)
    o.win.addEventListener('storage', onStorage)
  }
  function detach(): void {
    o.doc.removeEventListener('visibilitychange', onHidden)
    o.win.removeEventListener('pagehide', flush)
    o.win.removeEventListener(DRAFT_FLUSH, flush)
    o.win.removeEventListener(DRAFT_CLEARED, cleared)
    o.win.removeEventListener('storage', onStorage)
    flush()
  }

  return { touch, flush, attach, detach }
}
