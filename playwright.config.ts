// Browser E2E against a local dev pair (Worker + app) with a stub model provider. Local only: nothing here reaches production
// or a real provider. Chrome is the installed one (channel 'chrome'), so no browser is downloaded; CI installs its own.
import { defineConfig } from '@playwright/test'
import { API_URL, APP_PORT, APP_URL, STUB_URL } from './e2e/ports.mjs'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: APP_URL, testIdAttribute: 'data-test', viewport: { width: 390, height: 844 }, channel: process.env.CI ? undefined : 'chrome', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node e2e/stubProvider.mjs', url: `${STUB_URL}/requests`, reuseExistingServer: false, timeout: 30_000 },
    // Node 24 strips the TypeScript in api/src/keyBox.ts, which seed.mjs imports.
    { command: 'node e2e/startApi.mjs', url: `${API_URL}/me`, reuseExistingServer: false, timeout: 180_000 },
    {
      command: `pnpm exec vite --port ${APP_PORT} --strictPort`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
})
