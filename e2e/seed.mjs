// Seeds the local D1 with one test account, one session and one model whose base URL is the stub provider.
// The model row is written directly: the API only accepts https hostnames, so a localhost stub cannot go through PUT.
// Sealing uses the Worker's own keyBox, so the Worker opens the key exactly as it would a real one.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { sealKey } from '../api/src/keyBox.ts'
import { MODEL_KEY_SECRET, STATE_DIR, STUB_URL, TEST_EMAIL, TEST_KEY, TEST_TOKEN } from './ports.mjs'

export const USER_ID = 'e2e00000-0000-4000-8000-000000000001'
export const MODEL_ID = 'e2e00000-0000-4000-8000-0000000000aa'
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

export async function seed() {
  const now = Date.now()
  const tokenHash = createHash('sha256').update(TEST_TOKEN).digest('base64url')
  const sealed = await sealKey(MODEL_KEY_SECRET, TEST_KEY, USER_ID, MODEL_ID, STUB_URL)
  const sql = [
    `INSERT INTO users (id, email, name, created_at) VALUES (${q(USER_ID)}, ${q(TEST_EMAIL)}, 'E2E Owner', ${now});`,
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, device, last_seen_at) VALUES (${q(tokenHash)}, ${q(USER_ID)}, ${now}, ${now + 86_400_000}, 'E2E', ${now});`,
    `INSERT INTO models (user_id, id, label, format, base_url, model, max_tokens, key_ct, key_iv, key_hint, key_version, created_at, updated_at, is_default)
     VALUES (${q(USER_ID)}, ${q(MODEL_ID)}, 'Stub model', 'openai-chat', ${q(STUB_URL)}, 'stub-1', 4000, ${q(sealed.ct)}, ${q(sealed.iv)}, ${q(sealed.hint)}, ${sealed.version}, ${now}, ${now}, 1);`,
  ].join('\n')
  const file = join(STATE_DIR, 'seed.sql')
  writeFileSync(file, sql)
  execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--dir', 'api', 'exec', 'wrangler', 'd1', 'execute', 'planner', '--local', '--persist-to', STATE_DIR, '--file', file], {
    stdio: 'inherit', shell: process.platform === 'win32',
  })
}
