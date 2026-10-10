// Which environment am I looking at? Visual cues so a glance tells local dev, a production build served locally
// (preview), and production apart — accent, banner, tab title, favicon, Android status bar (theme-color).
// Production keeps the real look untouched. Environment-free core (`envFor`, `envIcon`): the Worker imports it too.

export type AppEnv = 'local' | 'preview' | 'prod'

export interface EnvLook {
  label: string // banner + title prefix; empty in prod
  accent: string // banner, header rule, status bar
}

export const ENV_LOOK: Record<AppEnv, EnvLook> = {
  local: { label: 'LOCAL DEV', accent: '#f59e0b' }, // amber
  preview: { label: 'PREVIEW BUILD', accent: '#d946ef' }, // fuchsia
  prod: { label: '', accent: '#38bdf8' }, // the real icon's accent; nothing changes in prod
}

/**
 * Dev server → local. A production build on this machine or the home network → preview (the phone opening
 * `vite preview --host` over Wi-Fi must not look like prod); S4 adds the hosted staging host here. Anything else →
 * prod. Decided at runtime, so the exact artifact that ships is the one tested.
 */
export function envFor(isDevServer: boolean, hostname: string): AppEnv {
  if (isDevServer) return 'local'
  return isLocalHost(hostname) ? 'preview' : 'prod'
}

function isLocalHost(h: string): boolean {
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true
  if (h.endsWith('.localhost') || h.endsWith('.local')) return true
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (!ip) return false
  const [a, b] = [Number(ip[1]), Number(ip[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/**
 * The favicon for a non-prod surface: env colour as the background, so it reads at 16 px in a tab. `PP` = the app,
 * `API` = the Worker, so the two are told apart side by side. (Prod uses the real files, not this.)
 */
export function envIcon(env: Exclude<AppEnv, 'prod'>, surface: 'app' | 'api'): string {
  const text = surface === 'app' ? 'PP' : 'API'
  const size = surface === 'app' ? 220 : 170
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="96" fill="${ENV_LOOK[env].accent}"/>
<text x="256" y="300" font-size="${size}" font-weight="800" text-anchor="middle" fill="#0f172a" font-family="system-ui, sans-serif" letter-spacing="-6">${text}</text>
<rect x="64" y="372" width="384" height="16" rx="8" fill="#0f172a"/>
</svg>`
}
