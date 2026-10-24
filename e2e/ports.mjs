// One place for the E2E ports and the dev-only values. Not the dev defaults (5176/8787/5179/8788): a parallel session's dev
// pair (RUNBOOK "Parallel sessions") may hold those. Override with E2E_* if these are taken.
import { fileURLToPath } from 'node:url'

export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 5191)
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8791)
export const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 8792)
export const APP_URL = `http://localhost:${APP_PORT}/planner/`
export const API_URL = `http://localhost:${API_PORT}`
export const STUB_URL = `http://localhost:${STUB_PORT}`
// The dev value from api/package.json `dev`: public, local-only, seals test keys only.
export const MODEL_KEY_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
// Persisted local D1 for this suite only; wiped at every start, so a run begins from a migrated empty database.
export const STATE_DIR = fileURLToPath(new URL('./.state', import.meta.url))
// Test values, never real: the account, its session token and the key the stub provider must be called with.
export const TEST_EMAIL = 'e2e-owner@example.com'
export const TEST_TOKEN = 'e2e-session-token-0000000000000000000000'
export const TEST_KEY = 'sk-e2e-stub-provider-key-1234'
