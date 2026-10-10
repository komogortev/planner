// Which build is this? Package version + git commit + build time, baked in by vite.config.ts.
import type { AppEnv } from './appEnv'

export interface BuildInfo {
  version: string
  commit: string // short sha; a trailing `+` = built with uncommitted changes
  builtAt: string // ISO
}

export const BUILD: BuildInfo = __APP_BUILD__

const pad = (n: number) => String(n).padStart(2, '0')

/** `v0.1.0 · 6ef0d07 · 10-10 13:33` (local time). On the dev server the time is when the server started, so: `dev`. */
export function versionLabel(b: BuildInfo, env: AppEnv): string {
  const d = new Date(b.builtAt)
  const when = env === 'local' ? 'dev' : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `v${b.version} · ${b.commit} · ${when}`
}
