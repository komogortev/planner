import { describe, expect, it } from 'vitest'
import { dragOffset, pageIndex, settle } from '../pages'

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
