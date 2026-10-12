// Where the app opens (owner, calibration 2026-10-12): the owner picks the way they mostly use it — record first (Home,
// the dictophone) or dashboard first. Default: Dashboard. Per device in localStorage, like the theme (a phone may be
// record-first while a desktop is dashboard-first). Applied once, to the app's first navigation (router/index.ts).
import { ref } from 'vue'

export type Landing = 'dashboard' | 'record'

const KEY = 'planner.landing'

export const LANDING_PATH: Record<Landing, string> = { dashboard: '/dashboard', record: '/' }

export function parseLanding(raw: string | null): Landing {
  return raw === 'record' || raw === 'dashboard' ? raw : 'dashboard'
}

function read(): Landing {
  try {
    return parseLanding(localStorage.getItem(KEY))
  } catch {
    return 'dashboard'
  }
}

export const landing = ref<Landing>(read())

export function setLanding(choice: Landing): void {
  landing.value = choice
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // Storage blocked: the choice holds for this session only.
  }
}

/**
 * The path the app's first navigation should go to: opening the app at its root (the installed app's start URL, `.`)
 * goes to the chosen landing page — a reload on Home too. Any other first URL (a link, a reload on another page) is
 * kept. null = keep `path`.
 */
export function landingRedirect(path: string, choice: Landing): string | null {
  return path === '/' && LANDING_PATH[choice] !== '/' ? LANDING_PATH[choice] : null
}
