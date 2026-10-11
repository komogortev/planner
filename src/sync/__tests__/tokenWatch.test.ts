// D-59: another window signed out, or in as someone else. This window hears it as a `storage` event on the token key and
// must stop acting for the account it was signed in as.
import { describe, expect, it, vi } from 'vitest'
import { TOKEN_KEY } from '@/auth/signIn'
import { handleTokenStorage, routeAfterSessionChange } from '../tokenWatch'

const deps = (signedIn: boolean) => ({ reset: vi.fn(), syncNow: vi.fn(), signedIn: () => signedIn, onSessionChange: vi.fn() })

describe('handleTokenStorage', () => {
  // Known positive: a token change is acted on, so the "ignored" cases below cannot pass on a handler that does nothing.
  it('a token signed in elsewhere: forget what was learned, tell the app, then sync — in that order, forced', () => {
    const d = deps(true)
    const order: string[] = []
    d.reset.mockImplementation(() => order.push('reset'))
    d.onSessionChange.mockImplementation(() => order.push('tell'))
    d.syncNow.mockImplementation((force?: boolean) => order.push(`sync(${force})`))
    handleTokenStorage({ key: TOKEN_KEY }, d)
    expect(order).toEqual(['reset', 'tell', 'sync(true)'])
  })

  it('a token removed elsewhere (signed out): forget, tell the app, and do not sync with nothing to sync with', () => {
    const d = deps(false)
    handleTokenStorage({ key: TOKEN_KEY }, d)
    expect(d.reset).toHaveBeenCalledTimes(1)
    expect(d.onSessionChange).toHaveBeenCalledWith(false)
    expect(d.syncNow).not.toHaveBeenCalled()
  })

  it('all storage cleared (key null) counts as a token change', () => {
    const d = deps(false)
    handleTokenStorage({ key: null }, d)
    expect(d.reset).toHaveBeenCalledTimes(1)
    expect(d.onSessionChange).toHaveBeenCalledWith(false)
  })

  it('any other key is none of its business', () => {
    const d = deps(true)
    handleTokenStorage({ key: 'planner.capture.draft' }, d)
    handleTokenStorage({ key: 'planner.signIn.pending' }, d)
    expect(d.reset).not.toHaveBeenCalled()
    expect(d.onSessionChange).not.toHaveBeenCalled()
    expect(d.syncNow).not.toHaveBeenCalled()
  })
})

// What the app does with that news (main.ts used to hold this inline, where nothing could test it).
describe('routeAfterSessionChange', () => {
  it('nobody is signed in any more: the sign-in screen, unless this window is already there', () => {
    expect(routeAfterSessionChange(false, 'home')).toBe('signin')
    expect(routeAfterSessionChange(false, 'dashboard')).toBe('signin')
    expect(routeAfterSessionChange(false, 'settings')).toBe('signin')
    expect(routeAfterSessionChange(false, 'signin')).toBeNull()
  })

  it('signed in elsewhere while this window waits on the sign-in screen: home', () => {
    expect(routeAfterSessionChange(true, 'signin')).toBe('home')
  })

  it('signed in elsewhere, this window is somewhere else: stay put (a different account shows as the foreign-account banner)', () => {
    expect(routeAfterSessionChange(true, 'dashboard')).toBeNull()
    expect(routeAfterSessionChange(true, 'settings')).toBeNull()
  })

  it('a route without a name is treated as any other page', () => {
    expect(routeAfterSessionChange(false, undefined)).toBe('signin')
    expect(routeAfterSessionChange(true, undefined)).toBeNull()
  })
})
