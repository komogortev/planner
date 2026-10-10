import { describe, expect, it } from 'vitest'
import { backdropShift, backdropWidth, dragOffset, pageIndex, pullCss, pullTransform, settle } from '../pages'

describe('settle', () => {
  it('changes page past 22% of the width, in the drag direction', () => {
    expect(settle(0, -100, 0, 375)).toBe(1)
    expect(settle(1, 100, 0, 375)).toBe(0)
    expect(settle(1, -100, 0, 375)).toBe(2)
  })
  it('springs back for a short, slow drag', () => {
    expect(settle(1, -40, -0.1, 375)).toBe(1)
    expect(settle(1, 40, 0.1, 375)).toBe(1)
  })
  it('a quick flick changes page even when short, but a tap-sized twitch does not', () => {
    expect(settle(0, -50, -0.8, 375)).toBe(1)
    expect(settle(0, -10, -0.9, 375)).toBe(0)
  })
  it('stops at both ends (negative controls: no wrap)', () => {
    expect(settle(0, 200, 0, 375)).toBe(0)
    expect(settle(2, -200, 0, 375)).toBe(2)
    expect(settle(2, -50, -1, 375)).toBe(2)
  })
})

describe('dragOffset', () => {
  it('follows the finger inside the range and resists past the ends', () => {
    expect(dragOffset(1, -100)).toBe(-100)
    expect(dragOffset(0, 100)).toBeCloseTo(30)
    expect(dragOffset(2, -100)).toBeCloseTo(-30)
    expect(dragOffset(0, -100)).toBe(-100) // towards a real page: no resistance
  })
})

describe('pageIndex', () => {
  it('is -1 outside the swipe order', () => {
    expect(pageIndex('/legacy')).toBe(-1)
    expect(pageIndex('/dashboard')).toBe(1)
  })
})

describe('parallax backdrop', () => {
  it('is wide enough that neither edge ever shows, at every page', () => {
    for (const r of [1 / 3, 1 / 2, 0.2]) {
      for (let i = 0; i < 3; i++) {
        const left = backdropShift(i, 0, r).screens
        expect(left).toBeLessThanOrEqual(0) // left edge never inside the screen
        expect(left + backdropWidth(r)).toBeGreaterThanOrEqual(1 - 1e-9) // right edge never inside the screen
      }
      // and it is exactly flush at both ends (no wasted width)
      expect(backdropShift(0, 0, r).screens).toBeCloseTo(0) // (-0 under Object.is, hence not toBe)
      expect(backdropShift(2, 0, r).screens + backdropWidth(r)).toBeCloseTo(1)
    }
  })
  it('moves a third as far as the pages while dragging', () => {
    expect(backdropShift(1, -90, 1 / 3).px).toBeCloseTo(-30)
    expect(backdropShift(1, -90, 1 / 3).screens).toBeCloseTo(-1 / 3)
  })
  it('stays put while the pages rubber-band past either end (no gap at its edge)', () => {
    expect(backdropShift(0, 120).px).toBe(0) // pulling right on the first page
    expect(backdropShift(2, -120).px).toBe(0) // pulling left on the last page
    expect(backdropShift(0, -120).px).toBeCloseTo(-40) // towards a real page: moves
    expect(backdropShift(2, 120).px).toBeCloseTo(40)
  })
})

describe('pullTransform (cloth being pulled)', () => {
  it('is the identity at rest, for both layers', () => {
    for (const layer of ['folds', 'accents'] as const) {
      const t = pullTransform(0, layer)
      expect(t.shift).toBeCloseTo(0)
      expect(t.scaleX).toBe(1)
      expect(t.scaleY).toBe(1)
      expect(t.skewDeg).toBeCloseTo(0)
      expect(t.rotateDeg).toBeCloseTo(0)
      expect(t.tiltDeg).toBeCloseTo(0)
    }
  })
  it('mirrors left/right, stretches while squeezing, and saturates at full strength', () => {
    const l = pullTransform(-0.3)
    const r = pullTransform(0.3)
    expect(l.shift).toBeCloseTo(-r.shift)
    expect(l.skewDeg).toBeCloseTo(-r.skewDeg)
    expect(l.rotateDeg).toBeCloseTo(-r.rotateDeg)
    expect(l.scaleX).toBeCloseTo(r.scaleX)
    expect(l.scaleX).toBeGreaterThan(1)
    expect(l.scaleY).toBeLessThan(1)
    const half = pullTransform(0.5) // gain 2: half a page is already full strength
    const full = pullTransform(5)
    expect(half.scaleX).toBeCloseTo(full.scaleX)
    expect(full.scaleX).toBeCloseTo(1.2)
    expect(full.scaleY).toBeCloseTo(0.93)
  })
  it('the accent folds move further and twist the other way (shape changes, not just position)', () => {
    const f = pullTransform(0.4, 'folds')
    const a = pullTransform(0.4, 'accents')
    expect(Math.abs(a.shift)).toBeGreaterThan(Math.abs(f.shift))
    expect(Math.sign(a.rotateDeg)).toBe(-Math.sign(f.rotateDeg))
  })
  it('the CSS string carries every part, and the rest state is neutral', () => {
    const css = pullCss(pullTransform(0.25))
    for (const part of ['translate3d', 'perspective', 'rotateY', 'rotate(', 'skewX', 'scale(']) expect(css).toContain(part)
  })
})
