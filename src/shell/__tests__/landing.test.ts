import { describe, expect, it } from 'vitest'
import { landingRedirect, parseLanding } from '../landing'

describe('landing page', () => {
  it('defaults to the dashboard; an unknown stored value is the default', () => {
    expect(parseLanding(null)).toBe('dashboard')
    expect(parseLanding('garbage')).toBe('dashboard')
    expect(parseLanding('record')).toBe('record')
  })
  it('opening at the root goes to the chosen page; record-first stays on Home', () => {
    expect(landingRedirect('/', 'dashboard')).toBe('/dashboard')
    expect(landingRedirect('/', 'record')).toBeNull()
  })
  it('any other first URL is kept', () => {
    expect(landingRedirect('/settings', 'dashboard')).toBeNull()
    expect(landingRedirect('/dashboard', 'record')).toBeNull()
  })
})
