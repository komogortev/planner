import type { Config } from 'tailwindcss'

// Warm textile palette (owner, 2026-10-10). Every `slate-*` class resolves through CSS variables defined in
// src/style.css, one set per theme (dark = :root, light = html[data-theme='light']), so the whole app follows the
// theme without touching each view. `slate-100` is "main text" and `slate-950` "page background" in BOTH themes.
const scale = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const slate = Object.fromEntries(scale.map((n) => [n, `rgb(var(--s-${n}) / <alpha-value>)`]))

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: { colors: { slate } },
  },
  plugins: [],
} satisfies Config
