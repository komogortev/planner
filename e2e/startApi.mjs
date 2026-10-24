// Starts the Worker for the E2E suite on a wiped, migrated, local-only D1 (never --remote), then seeds the test account.
import { spawn, execFileSync } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'
import { API_PORT, APP_URL, MODEL_KEY_SECRET, STATE_DIR } from './ports.mjs'
import { seed } from './seed.mjs'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const shell = process.platform === 'win32'
const wrangler = (args) => ['--dir', 'api', 'exec', 'wrangler', ...args]
rmSync(STATE_DIR, { recursive: true, force: true })
mkdirSync(STATE_DIR, { recursive: true })
execFileSync(pnpm, wrangler(['d1', 'migrations', 'apply', 'planner', '--local', '--persist-to', STATE_DIR]), { stdio: 'inherit', shell })
await seed()
spawn(pnpm, wrangler([
  'dev', '--port', String(API_PORT), '--persist-to', STATE_DIR,
  '--var', `ALLOWED_APP_URLS:${APP_URL}`, '--var', 'APP_ENV:local', '--var', `MODEL_KEY_SECRET:${MODEL_KEY_SECRET}`,
]), { stdio: 'inherit', shell })
