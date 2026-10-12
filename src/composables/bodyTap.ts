// Widget body taps (owner, calibration 2026-10-12): a single clean tap on a widget's body toggles its detailed view, when
// it has one — the same as its own open/close button. A tap on a control (button, field, link, disclosure) is that
// control's, never the body's; nor is a tap that ends a text selection.

const CONTROLS = 'button, input, textarea, select, a, label, summary, [contenteditable="true"]'

/**
 * Whether a click on a widget is a tap on its body. `own` is a selector for controls that *are* the body's toggle (e.g.
 * the title button), which count as body taps.
 */
export function isBodyTap(e: MouseEvent, own?: string): boolean {
  const t = e.target
  if (!(t instanceof Element)) return false
  const control = t.closest(CONTROLS)
  if (control && !(own && control.matches(own))) return false
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
  return !(sel && !sel.isCollapsed && sel.toString().trim() !== '')
}
