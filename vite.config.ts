import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Build identity, baked in at build (or dev-server start): package version + the git commit + build time. Shown in the
// version badge, written to dist/version.json (read by `pnpm smoke`), and stamped into sync snapshots.
const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}
const BUILD = {
  version: (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version,
  // `+` = built from a working tree with uncommitted changes, so the commit alone does not describe it.
  commit: (git('rev-parse --short HEAD') || 'unknown') + (git('status --porcelain') ? '+' : ''),
  builtAt: new Date().toISOString(),
}

export default defineConfig({
  // GH Pages subpath — repo: komogortev/planner
  base: '/planner/',
  define: {
    __APP_BUILD__: JSON.stringify(BUILD),
  },
  // The Worker's local ALLOWED_APP_URLS (api/package.json `dev`) names this port; any other is refused.
  server: { port: 5176, strictPort: true },
  plugins: [
    vue(),
    {
      // dist/version.json: what this deploy is, readable without running the app (`pnpm smoke` compares it to main).
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) + '\n' })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Personal Planner',
        short_name: 'Planner',
        description: 'Personal planning + tracking — commitments, intentions, market log',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '.',
        scope: './',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
