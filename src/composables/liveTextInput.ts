// Every text field updates its v-model on every keystroke, also mid-word on a phone keyboard (owner, 2026-10-13: "typing
// answer and clicking answer did not produce change"). Vue's v-model skips input events while an IME composition is open
// (`el.composing`, runtime-dom vModelText), and Android keyboards with suggestions compose every word until a space or a
// blur. So the model read '' while the field showed "Thursday", the Answer button stayed disabled and the tap was lost.
// One capture-phase listener on the document clears the flag before Vue's own listener on the field runs, for every
// v-model in the app: no field can be missed, and a new one needs nothing.

/** Clears Vue's composing flag on the input's target, so v-model takes the value now. */
export function liveInput(e: Pick<Event, 'target'>): void {
  const t = e.target as (EventTarget & { composing?: boolean }) | null
  if (t && t.composing) t.composing = false
}

export function installLiveTextInput(doc: Pick<Document, 'addEventListener'> = document): void {
  doc.addEventListener('input', liveInput, true)
}
