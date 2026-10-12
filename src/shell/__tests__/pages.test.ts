import { describe, expect, it } from 'vitest'
import {
  LAYER_RATE,
  PAGES,
  PARALLAX,
  backdropShift,
  backdropWidth,
  dragOffset,
  layerShift,
  layerShiftCss,
  pageIndex,
  pullCss,
  undersideAmount,
  pullTransform,
  settle,
} from '../pages'

const LAST = PAGES.length - 1

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
    expect(settle(LAST, -200, 0, 375)).toBe(LAST)
    expect(settle(LAST, -50, -1, 375)).toBe(LAST)
  })
})

describe('dragOffset', () => {
  it('follows the finger inside the range and resists past the ends', () => {
    expect(dragOffset(1, -100)).toBe(-100)
    expect(dragOffset(0, 100)).toBeCloseTo(30)
    expect(dragOffset(LAST, -100)).toBeCloseTo(-30)
    expect(dragOffset(0, -100)).toBe(-100) // towards a real page: no resistance
  })
})

describe('pageIndex', () => {
  it('is -1 outside the swipe order', () => {
    expect(pageIndex('/legacy')).toBe(-1)
    expect(pageIndex('/dashboard')).toBe(1)
    expect(pageIndex('/widgets')).toBe(2) // between Dashboard and Settings (D-18)
    expect(pageIndex('/settings')).toBe(LAST)
  })
})

describe('parallax backdrop', () => {
  it('is wide enough that neither edge ever shows, at every page', () => {
    for (const r of [1 / 3, 1 / 2, 0.2]) {
      for (let i = 0; i < PAGES.length; i++) {
        const left = backdropShift(i, 0, r).screens
        expect(left).toBeLessThanOrEqual(0) // left edge never inside the screen
        expect(left + backdropWidth(r)).toBeGreaterThanOrEqual(1 - 1e-9) // right edge never inside the screen
      }
      // and it is exactly flush at both ends (no wasted width)
      expect(backdropShift(0, 0, r).screens).toBeCloseTo(0) // (-0 under Object.is, hence not toBe)
      expect(backdropShift(LAST, 0, r).screens + backdropWidth(r)).toBeCloseTo(1)
    }
  })
  it('moves a third as far as the pages while dragging', () => {
    expect(backdropShift(1, -90, 1 / 3).px).toBeCloseTo(-30)
    expect(backdropShift(1, -90, 1 / 3).screens).toBeCloseTo(-1 / 3)
  })
  it('stays put while the pages rubber-band past either end (no gap at its edge)', () => {
    expect(backdropShift(0, 120).px).toBe(0) // pulling right on the first page
    expect(backdropShift(LAST, -120).px).toBe(0) // pulling left on the last page
    expect(backdropShift(0, -120).px).toBeCloseTo(-40) // towards a real page: moves
    expect(backdropShift(LAST, 120).px).toBeCloseTo(40)
  })
})

describe('pullTransform (cloth being pulled)', () => {
  it('is the identity at rest, for both layers', () => {
    for (const layer of ['folds', 'accents'] as const) {
      const t = pullTransform(0, layer)
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
  it('the accent folds twist the other way (the shape changes relative to the folds)', () => {
    const f = pullTransform(0.4, 'folds')
    const a = pullTransform(0.4, 'accents')
    expect(Math.sign(a.rotateDeg)).toBe(-Math.sign(f.rotateDeg))
  })
  it('the CSS string carries every shape part and no position (that is the separate translate)', () => {
    const css = pullCss(pullTransform(0.25))
    for (const part of ['perspective', 'rotateY', 'rotate(', 'skewX', 'scale(']) expect(css).toContain(part)
    expect(css).not.toContain('translate')
  })
})

describe('layerShift (the cloth keeps where the swipe ended)', () => {
  it('a completed swipe ends exactly where the next page rests: nothing to scroll back to', () => {
    for (const layer of ['folds', 'accents'] as const) {
      for (let i = 0; i < LAST; i++) {
        expect(layerShift(i, -1, layer)).toBeCloseTo(layerShift(i + 1, 0, layer)) // forward
        expect(layerShift(i + 1, 1, layer)).toBeCloseTo(layerShift(i, 0, layer)) // and back
      }
    }
  })
  it('moves with the finger, the same way as the pages, and the accents move further', () => {
    expect(layerShift(1, -0.3)).toBeLessThan(layerShift(1, 0)) // dragging left → the layer goes left
    expect(layerShift(1, 0.3)).toBeGreaterThan(layerShift(1, 0))
    const step = (l: 'folds' | 'accents') => layerShift(0, 0, l) - layerShift(1, 0, l)
    expect(step('accents')).toBeGreaterThan(step('folds'))
    expect(step('folds')).toBeCloseTo(LAYER_RATE.folds)
  })
  it('a swipe that springs back returns to the same rest position (negative control: it is a function of the page)', () => {
    expect(layerShift(2, 0)).toBe(layerShift(2, -0)) // no hidden state
    expect(layerShift(2, -0.1)).not.toBeCloseTo(layerShift(2, 0)) // the drag does move it
  })
  it('is symmetric about the middle of the pager', () => {
    expect(layerShift(0, 0)).toBeCloseTo(-layerShift(LAST, 0))
  })
  it('never lets a layer edge into the screen, at any page, leaving room for the 6° shear (~0.1 of a page)', () => {
    const bw = backdropWidth()
    const spare = 0.16 * bw // `.t-folds` / `.t-accents`: inset -16% of the backdrop's width
    for (const layer of ['folds', 'accents'] as const) {
      for (let i = 0; i < PAGES.length; i++) {
        const t = layerShift(i, 0, layer)
        const left = i * PARALLAX // the screen's left edge, in backdrop coordinates
        const room = Math.min(left - (-spare + t), bw + spare + t - (left + 1))
        expect(room).toBeGreaterThan(0.1)
      }
    }
  })
  it('the CSS is a translate in pager widths', () => {
    expect(layerShiftCss(-0.25)).toBe('-25cqw 0')
  })
})

describe('the underside (Settings)', () => {
  it('is 0 before the last swipe, 1 on Settings, and follows the finger across the last swipe only', () => {
    expect(undersideAmount(0, 0)).toBe(0)
    expect(undersideAmount(1, 0)).toBe(0)
    expect(undersideAmount(2, 0)).toBe(0)
    expect(undersideAmount(3, 0)).toBe(1)
    expect(undersideAmount(2, -0.5)).toBeCloseTo(0.5) // half way from Widgets to Settings
    expect(undersideAmount(3, 0.25)).toBeCloseTo(0.75) // dragging back from Settings
    expect(undersideAmount(1, -0.9)).toBe(0) // Dashboard → Widgets never darkens
    expect(undersideAmount(3, -0.3)).toBe(1) // rubber-band past the end stays at 1
  })
})
