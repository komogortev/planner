import {
  defineConfig,
  minimal2023Preset as preset,
} from '@vite-pwa/assets-generator/config'

/**
 * Generates PWA icons + apple-touch-icon + favicon from a single SVG source.
 *
 * Source: public/icon.svg
 * Run:    pnpm generate-pwa-assets
 * Output: public/pwa-64x64.png, pwa-192x192.png, pwa-512x512.png,
 *         maskable-icon-512x512.png, apple-touch-icon-180x180.png,
 *         favicon.ico
 */
export default defineConfig({
  preset,
  images: ['public/icon.svg'],
})
