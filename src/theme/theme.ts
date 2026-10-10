// Light / dark appearance (owner, 2026-10-10). The choice lives in localStorage (per device — a phone and a desktop
// may differ); 'system' follows the OS. `applyTheme()` runs before the app mounts (main.ts) so there is no flash of the
// wrong theme. The CSS side is in src/style.css (variables under html[data-theme='light']).
import { ref } from 'vue'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'planner.theme'
const THEME_COLOR: Record<Theme, string> = { dark: '#1d1712', light: '#d9c7a8' }

export function parseChoice(raw: string | null): ThemeChoice {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark'
}

export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): Theme {
  if (choice === 'system') return systemPrefersLight ? 'light' : 'dark'
  return choice
}

function readChoice(): ThemeChoice {
  try {
    return parseChoice(localStorage.getItem(KEY))
  } catch {
    return 'dark'
  }
}

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null

/** The user's choice (reactive) and the theme actually in force (reactive). */
export const themeChoice = ref<ThemeChoice>(readChoice())
export const activeTheme = ref<Theme>(resolveTheme(themeChoice.value, mq?.matches ?? false))

export function applyTheme(): void {
  const theme = resolveTheme(themeChoice.value, mq?.matches ?? false)
  activeTheme.value = theme
  const root = document.documentElement
  if (theme === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')
  // Android status bar / browser chrome colour — unless an environment cue (src/env) owns it in a non-prod build.
  if (!root.hasAttribute('data-env')) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  themeChoice.value = choice
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // Storage blocked: the choice holds for this session only.
  }
  applyTheme()
}

// 'system' follows the OS live.
mq?.addEventListener?.('change', () => {
  if (themeChoice.value === 'system') applyTheme()
})
