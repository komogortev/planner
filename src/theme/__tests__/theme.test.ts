import { describe, expect, it } from 'vitest'
import { parseChoice, resolveTheme } from '../theme'

describe('resolveTheme', () => {
  it('an explicit choice wins over the OS', () => {
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
  })
  it('system follows the OS', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })
})

describe('parseChoice', () => {
  it('accepts the three values and falls back to dark for anything else', () => {
    expect(parseChoice('light')).toBe('light')
    expect(parseChoice('system')).toBe('system')
    expect(parseChoice(null)).toBe('dark')
    expect(parseChoice('purple')).toBe('dark') // negative control: a corrupted value never selects an unknown theme
  })
})
