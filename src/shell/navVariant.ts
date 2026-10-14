// Which navigation layout this device shows (D-117 test, owner 2026-10-14): B = the bottom band's More sheet (default),
// A = a top app bar with the page name, a menu and, on a wide screen, the pages as tabs. Switched from the menu itself.
// Per device in localStorage, like the landing page and the theme.
import { ref } from 'vue'

export type NavVariant = 'a' | 'b'

const KEY = 'planner.nav.variant'

export function parseNavVariant(raw: string | null): NavVariant {
  return raw === 'a' ? 'a' : 'b'
}

function read(): NavVariant {
  try {
    return parseNavVariant(localStorage.getItem(KEY))
  } catch {
    return 'b'
  }
}

export const navVariant = ref<NavVariant>(read())

export function setNavVariant(v: NavVariant): void {
  navVariant.value = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // Storage blocked: the choice holds for this session only.
  }
}
