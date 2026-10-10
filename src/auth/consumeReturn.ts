// Side-effect module: main.ts imports it FIRST. Imports are hoisted, and createWebHistory() captures the URL when
// router/index.ts is evaluated — a call in main.ts's body runs too late, and the router writes the token URL back.
import { consumeSignInReturn } from './signIn'

try {
  consumeSignInReturn()
} catch (err) {
  // A throw here would fail the whole module graph and blank the app.
  console.error('[auth] sign-in return handling failed:', err)
}
