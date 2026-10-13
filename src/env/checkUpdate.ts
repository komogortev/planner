// Settings → App info → Check for updates (owner, 2026-10-13: "so I can proactively update the installed PWA"). The
// deployed build says which commit it is in `version.json` (emitted by vite.config.ts, not precached by the service
// worker); this build knows its own (`BUILD.commit`). Different → ask the service worker to fetch the new one, and
// `autoUpdate` reloads the app into it once it is installed.
import { BUILD } from './version'

export type UpdateCheck =
  | { kind: 'latest'; commit: string }
  | { kind: 'updating'; commit: string }
  | { kind: 'unavailable'; reason: string }

export interface UpdateDeps {
  current: string
  /** The deployed build's commit, read past every cache. */
  deployed: () => Promise<string>
  registration: () => Promise<Pick<ServiceWorkerRegistration, 'update'> | undefined>
}

const defaultDeps: UpdateDeps = {
  current: BUILD.commit,
  deployed: async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`version.json answered ${res.status}`)
    const v = (await res.json()) as { commit?: unknown }
    if (typeof v.commit !== 'string' || !v.commit) throw new Error('version.json has no commit')
    return v.commit
  },
  registration: async () => ('serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : undefined),
}

export async function checkForUpdate(deps: UpdateDeps = defaultDeps): Promise<UpdateCheck> {
  let deployed: string
  try {
    deployed = await deps.deployed()
  } catch {
    return { kind: 'unavailable', reason: 'Could not reach the server. Check the connection and try again.' }
  }
  if (deployed === deps.current) return { kind: 'latest', commit: deployed }
  const reg = await deps.registration().catch(() => undefined)
  if (!reg) return { kind: 'unavailable', reason: `Version ${deployed} is out, but this browser runs no app worker: reload the page.` }
  try {
    await reg.update()
  } catch {
    return { kind: 'unavailable', reason: `Version ${deployed} is out, but fetching it failed. Try again.` }
  }
  return { kind: 'updating', commit: deployed }
}
