// The Capture key, as a plain function (D-56): what is in the box is captured once, and only what was captured leaves the
// box. The Vue view only wires a ref and a button to it, so the behaviour can be tested without a browser.
import type { CaptureResult } from './capture'
import { singleFlight } from '@/utils/singleFlight'

export interface Box {
  get: () => string
  set: (text: string) => void
}

export type Submitted =
  | { kind: 'empty' } // nothing to capture: the caller focuses the box
  | { kind: 'error'; error: string } // refused (cleaning rules): the text stays where it is
  | { kind: 'saved'; sent: string; left: string } // captured `sent`; `left` is what the box still holds (text typed while it was being written)

/**
 * Captures the box's text. The text is read ONCE, and afterwards the box loses exactly that text and nothing else: a
 * dictation commit or a keystroke that lands during the write stays in the box (appended text) — and when the owner edited
 * INSIDE the captured text meanwhile, the box is left alone, because a duplicate is visible and a silent loss is not.
 */
export async function submitCapture(box: Box, capture: (body: string) => Promise<CaptureResult>): Promise<Submitted> {
  const sent = box.get()
  if (sent.trim() === '') return { kind: 'empty' }
  const r = await capture(sent)
  if (!r.ok) return { kind: 'error', error: r.error }
  const now = box.get()
  if (now === sent) box.set('')
  else if (now.startsWith(sent)) box.set(now.slice(sent.length))
  return { kind: 'saved', sent, left: box.get() }
}

/** One capture at a time: a second tap while the first is still writing is dropped (resolves `undefined`), not queued. */
export function createSubmitter(box: Box, capture: (body: string) => Promise<CaptureResult>) {
  return singleFlight(() => submitCapture(box, capture))
}
