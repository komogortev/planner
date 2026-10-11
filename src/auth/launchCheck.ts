// What Settings shows about the account when it opens — and nothing else (D-55).
//
// Settings is mounted at launch: the pager keeps all four pages alive, so this runs on every cold start, on Home. A server
// verdict (401, "account deleted") must therefore only ever change what is DISPLAYED. Wiping the device here once took the
// only copy of the notes before the banner could offer a copy. This module imports nothing that can change the device's
// data, and `__tests__/launchCheck.test.ts` keeps it that way (and keeps SettingsView's onMounted from calling anything
// destructive). The destructive gestures live in `account.ts`, behind a button.
import { fetchMe, type Me } from './signIn'

export type AccountLine = Me | { error: string }

export async function checkAccount(fetchVerdict: typeof fetchMe = fetchMe): Promise<AccountLine> {
  const r = await fetchVerdict()
  if (r === 'account-deleted') return { error: 'this account was deleted' }
  if (r === 'signed-out') return { error: 'signed out of the server' }
  return r
}
