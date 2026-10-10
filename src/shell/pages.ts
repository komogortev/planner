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

/**
 * Parallax (owner's test, 2026-10-10): the backdrop moves with the pages but only `PARALLAX` of their distance. With
 * three pages the track travels 2 screen widths, the backdrop 2 * PARALLAX of one, so it is (1 + 2 * PARALLAX) screen
 * widths wide: its left edge meets the screen's at the first page and its right edge at the last.
 * (1/3 per page → a 5/3-screen-wide backdrop. The owner also described "200 vs 300 total", which is 1/2 per page —
 * change this one number to try it.)
 */
export const PARALLAX = 1 / 3

/** Backdrop width as a multiple of the screen width. */
export function backdropWidth(ratio = PARALLAX, count = PAGES.length): number {
  return 1 + (count - 1) * ratio
}

/**
 * Backdrop left edge, in screen widths (≤ 0) plus the live drag in px, for page `index`. Past either end (the pages
 * rubber-band) the backdrop stays put: it has no spare width there, so moving it would open a gap at its edge.
 */
export function backdropShift(
  index: number,
  dragPx: number,
  ratio = PARALLAX,
  count = PAGES.length,
): { screens: number; px: number } {
  const pastEnd = (index === 0 && dragPx > 0) || (index === count - 1 && dragPx < 0)
  return { screens: -index * ratio, px: pastEnd ? 0 : dragPx * ratio }
}

/**
 * "Cloth being pulled" (owner's test): while a page is dragged, the folds are shifted, stretched, squeezed, sheared,
 * twisted and tilted in the drag direction, then ease back — strong enough cloth to keep its folds. `p` is the drag as
 * a fraction of the page width; the effect reaches full strength at `1 / GAIN` of a page (so an ordinary swipe is
 * clearly visible) and is clamped there. At rest (p = 0) everything is the identity.
 *
 * The folds and the two accent folds use different multipliers (accents shift further and twist the other way), so
 * their positions relative to each other change too — the shape changes, not only the position.
 */
export const PULL = {
  gain: 2, // full strength at half a page of drag
  shift: 0.16, // × page width
  stretch: 0.2, // extra width along the pull
  squeeze: 0.07, // height lost as it stretches (cloth keeps its area, roughly)
  skewDeg: 6,
  rotateDeg: 2.2,
  tiltDeg: 9, // perspective tilt: the far side of a fold foreshortens
} as const

export type PullLayer = 'folds' | 'accents'
const LAYER = { folds: { shift: 1, rotate: 1 }, accents: { shift: 1.6, rotate: -1.3 } } as const

export interface Pull {
  shift: number
  scaleX: number
  scaleY: number
  skewDeg: number
  rotateDeg: number
  tiltDeg: number
}

export function pullTransform(p: number, layer: PullLayer = 'folds'): Pull {
  const c = Math.max(-1, Math.min(1, p * PULL.gain))
  const k = LAYER[layer]
  return {
    shift: c * PULL.shift * k.shift,
    scaleX: 1 + Math.abs(c) * PULL.stretch,
    scaleY: 1 - Math.abs(c) * PULL.squeeze,
    skewDeg: -c * PULL.skewDeg,
    rotateDeg: c * PULL.rotateDeg * k.rotate,
    tiltDeg: -c * PULL.tiltDeg,
  }
}

/** The CSS transform for a Pull (`cqw` = the pager's width). */
export function pullCss(t: Pull): string {
  return (
    `translate3d(${t.shift * 100}cqw, 0, 0) perspective(900px) rotateY(${t.tiltDeg}deg) rotate(${t.rotateDeg}deg) ` +
    `skewX(${t.skewDeg}deg) scale(${t.scaleX}, ${t.scaleY})`
  )
}
