import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { signOutSafely } from './account'

// Sign out, from Settings → Account or the bottom band's More sheet (D-117): one flow, so the two never drift. D-28: signing out
// clears this device's notes (D-50), so it is refused while some have not reached the server, or while the capture box
// holds an unsent draft (D-56); the caller shows `blocked` / `draft` / `error`.
export function useSignOut() {
  const router = useRouter()
  const blocked = ref<number | null>(null)
  const draft = ref(false)
  const error = ref<string | null>(null)

  async function signOut(): Promise<boolean> {
    error.value = null
    try {
      const r = await signOutSafely()
      if (!r.ok) {
        blocked.value = r.unsynced
        draft.value = r.draft === true
        return false
      }
      void router.push({ name: 'signin' })
      return true
    } catch (err) {
      // The clear failed and was rolled back (device and token as they were): say so instead of an unhandled rejection.
      error.value = `Could not sign out: ${err instanceof Error ? err.message : String(err)}`
      return false
    }
  }

  return { signOut, blocked, draft, error }
}
