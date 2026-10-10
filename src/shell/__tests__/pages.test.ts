import { describe, expect, it } from 'vitest'
import { isSwipe, swipeTarget } from '../pages'

describe('swipeTarget', () => {
  it('moves to the adjacent page', () => {
    expect(swipeTarget('/', -100)).toBe('/dashboard')
    expect(swipeTarget('/dashboard', 100)).toBe('/')
    expect(swipeTarget('/dashboard', -100)).toBe('/settings')
  })
  it('stops at both ends (negative controls: no wrap)', () => {
    expect(swipeTarget('/', 100)).toBeNull()
    expect(swipeTarget('/settings', -100)).toBeNull()
  })
  it('ignores pages outside the order', () => {
    expect(swipeTarget('/legacy', -100)).toBeNull()
  })
})

describe('isSwipe', () => {
  it('needs distance and horizontal dominance', () => {
    expect(isSwipe(80, 10)).toBe(true)
    expect(isSwipe(30, 0)).toBe(false)
    expect(isSwipe(80, 70)).toBe(false)
  })
})
