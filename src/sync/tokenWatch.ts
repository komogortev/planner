// Another window signed out, or in as someone else (D-59). The token lives in localStorage, so this window hears it as a
// `storage` event on the token key. Until then it still thinks it is the account it was: its engine has learned that
// account's id, a note captured here would join the outbox of an account that is no longer signed in, and a page of the
// signed-out account stays on screen.
import { TOKEN_KEY } from '@/auth/signIn'

export interface TokenWatchDeps {
  /** Forget what the engine learned about the account. */
  reset: () => void
  syncNow: (force?: boolean) => void
  signedIn: () => boolean
  /** The app decides what to show: sign-in screen when nobody is signed in any more. */
  onSessionChange?: (signedIn: boolean) => void
}

/**
 * What this window shows after another one signed out or in: the sign-in screen when nobody is signed in any more; home when
 * someone signed in while this window waited on the sign-in screen; otherwise nothing (a different account shows up as the
 * foreign-account banner). `null`: stay where you are. Pure, so the rule can be tested; main.ts only follows it.
 */
export function routeAfterSessionChange(signedIn: boolean, routeName: unknown): 'signin' | 'home' | null {
  if (!signedIn) return routeName === 'signin' ? null : 'signin'
  return routeName === 'signin' ? 'home' : null
}

/** `key` null: the whole storage was cleared, which is a token change too. */
export function handleTokenStorage(e: { key: string | null }, d: TokenWatchDeps): void {
  if (e.key !== null && e.key !== TOKEN_KEY) return
  d.reset()
  const signedIn = d.signedIn()
  d.onSessionChange?.(signedIn)
  if (signedIn) d.syncNow(true)
}
