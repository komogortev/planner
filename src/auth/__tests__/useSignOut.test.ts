// The sign-out flow shared by Settings → Account and the More sheet (D-117). signOutSafely itself is covered in
// account.test.ts; this pins what the two callers rely on: a refused or failed sign-out never leaves the page.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
const signOutSafely = vi.fn()
vi.mock('../account', () => ({ signOutSafely: (...a: unknown[]) => signOutSafely(...a) }))

const { useSignOut } = await import('../useSignOut')

describe('useSignOut', () => {
  beforeEach(() => {
    push.mockReset()
    signOutSafely.mockReset()
  })

  it('signed out: goes to the sign-in page, nothing to show', async () => {
    signOutSafely.mockResolvedValue({ ok: true })
    const s = useSignOut()
    expect(await s.signOut()).toBe(true)
    expect(push).toHaveBeenCalledWith({ name: 'signin' })
    expect([s.blocked.value, s.draft.value, s.error.value]).toEqual([null, false, null])
  })

  it('refused (unsynced notes, a draft): says why and stays', async () => {
    signOutSafely.mockResolvedValue({ ok: false, unsynced: 2, draft: true })
    const s = useSignOut()
    expect(await s.signOut()).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect([s.blocked.value, s.draft.value]).toEqual([2, true])
  })

  it('the clear failed: an error line, no navigation, and the next try starts clean', async () => {
    signOutSafely.mockRejectedValueOnce(new Error('disk'))
    const s = useSignOut()
    expect(await s.signOut()).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect(s.error.value).toBe('Could not sign out: disk')
    signOutSafely.mockResolvedValueOnce({ ok: true })
    await s.signOut()
    expect(s.error.value).toBeNull()
  })
})
