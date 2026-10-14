import { describe, expect, it } from 'vitest'
import { parseNavVariant } from '../navVariant'

describe('navigation layout', () => {
  it('defaults to B (the More sheet); only "a" picks the top bar', () => {
    expect(parseNavVariant(null)).toBe('b')
    expect(parseNavVariant('garbage')).toBe('b')
    expect(parseNavVariant('A')).toBe('b')
    expect(parseNavVariant('a')).toBe('a')
  })
})
