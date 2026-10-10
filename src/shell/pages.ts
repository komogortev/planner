// Phone shell pages, in swipe order (notes 8-9, 2026-10-10). Swiping stops at both ends — no wrap-around.
export const PAGES = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/settings', label: 'Settings' },
] as const

/** Index of the page a path belongs to, or -1 (e.g. /legacy, /spike-auth: outside the swipe order). */
export function pageIndex(path: string): number {
  return PAGES.findIndex((p) => p.to === path)
}

/** Target of a swipe: dx < 0 (finger moves left) goes to the next page, dx > 0 to the previous. null at the ends. */
export function swipeTarget(path: string, dx: number): string | null {
  const i = pageIndex(path)
  if (i < 0) return null
  const j = dx < 0 ? i + 1 : i - 1
  return PAGES[j]?.to ?? null
}

/** A swipe is a mostly-horizontal drag of at least `minPx`. */
export function isSwipe(dx: number, dy: number, minPx = 60): boolean {
  return Math.abs(dx) >= minPx && Math.abs(dx) > 1.5 * Math.abs(dy)
}
