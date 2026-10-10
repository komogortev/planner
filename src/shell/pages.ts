// Phone shell pages, in swipe order (notes 8-9, 2026-10-10). Swiping stops at both ends — no wrap-around.
export const PAGES = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/settings', label: 'Settings' },
] as const

/** Index of the page a path belongs to, or -1 (e.g. /legacy, /signin: outside the swipe order). */
export function pageIndex(path: string): number {
  return PAGES.findIndex((p) => p.to === path)
}

/**
 * Where a drag ends. `dx` is the finger's horizontal travel (negative = towards the next page), `vx` its release
 * velocity in px/ms, `width` the page width. A page change needs either 22% of the width or a quick flick;
 * otherwise the page springs back. The result is clamped to the first and last page — no wrap-around (note 9).
 */
export function settle(index: number, dx: number, vx: number, width: number, count = PAGES.length): number {
  const far = Math.abs(dx) > width * 0.22
  const flick = Math.abs(vx) > 0.45 && Math.abs(dx) > 24
  if (!far && !flick) return index
  const next = index + (dx < 0 ? 1 : -1)
  return Math.min(count - 1, Math.max(0, next))
}

/** Drag offset with rubber-band resistance when pulling past the first or last page. */
export function dragOffset(index: number, dx: number, count = PAGES.length): number {
  const pastStart = index === 0 && dx > 0
  const pastEnd = index === count - 1 && dx < 0
  return pastStart || pastEnd ? dx * 0.3 : dx
}
