// Worker tests run inside workerd (the real runtime) with a local D1, migrated fresh for each test file.
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Fixed test values: tests never read `api/.env` and never reach a real provider (fetch is stubbed).
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOWED_APP_URLS: 'https://app.test/planner/',
            ALLOWED_EMAILS: 'owner@example.com',
            GITHUB_CLIENT_ID: 'gh-test-id',
            GITHUB_CLIENT_SECRET: 'gh-test-secret',
            GOOGLE_CLIENT_ID: 'google-test-id',
            GOOGLE_CLIENT_SECRET: 'google-test-secret',
          },
        },
      }),
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] },
  }
})
