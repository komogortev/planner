// Browser side of the environment cue: marks <html data-env>, retitles the tab, swaps the favicon, recolours the
// Android status bar. In prod it does nothing at all — not a single read or write of the document.
import { ENV_LOOK, envFor, envIcon, type AppEnv } from './appEnv'

// `globalThis.location?` so this module also loads in unit tests (no DOM there).
export const APP_ENV: AppEnv = envFor(import.meta.env.DEV, globalThis.location?.hostname ?? '')

export function applyEnvCue(env: AppEnv = APP_ENV, doc: Document = document): void {
  if (env === 'prod') return
  const look = ENV_LOOK[env]
  doc.documentElement.dataset.env = env
  doc.documentElement.style.setProperty('--env-accent', look.accent)
  doc.title = `[${look.label}] ${doc.title}`
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.accent)

  // Drop every page icon (svg + png), then add the env one — a leftover png would win in some browsers.
  doc.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove())
  const link = doc.createElement('link')
  link.rel = 'icon'
  link.type = 'image/svg+xml'
  link.href = `data:image/svg+xml,${encodeURIComponent(envIcon(env, 'app'))}`
  doc.head.appendChild(link)
}
