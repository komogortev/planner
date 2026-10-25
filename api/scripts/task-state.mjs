#!/usr/bin/env node
// Break-glass: set the state of owner Tasks directly in D1, the way the push route would (api/src/records.ts).
// The normal path is the app (or /sync/push with a session). Use this only when no session is available.
//
//   node scripts/task-state.mjs <email> <taskId...> --state done|dropped|open [--remote] [--apply]
//
// Dry run by default: it reads the rows, prints the plan and writes nothing. --apply writes one batch:
// per task it bumps users.version_seq, keeps the replaced row in record_revisions, and updates the record on the
// new version, guarded by the version it read (a row that moved in between is left alone and reported).
// Every device then pulls the change on its next sync. Local D1 by default; production needs --remote.
// Emails and ids are typed here, never committed (public repo).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js')

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--state')
const [rawEmail, ...prefixes] = positional
const state = opt('--state')
const where = flag('--remote') ? '--remote' : '--local'
const apply = flag('--apply')

const die = (m) => { console.error(m); process.exit(1) }
const email = (rawEmail ?? '').trim().toLowerCase()
if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) die(`not an email: ${rawEmail ?? '(none)'}`)
if (!['done', 'dropped', 'open'].includes(state ?? '')) die('--state must be done, dropped or open')
if (!prefixes.length) die('name at least one task id (8+ hex characters of the id)')
for (const p of prefixes) if (!/^[0-9a-f-]{8,36}$/.test(p)) die(`not a task id prefix: ${p}`)

const sq = (s) => `'${String(s).replace(/'/g, "''")}'`

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--json', '--command', sql], { cwd: apiDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  return JSON.parse(out)[0].results ?? []
}

const user = d1(`SELECT id, version_seq FROM users WHERE email = ${sq(email)}`)
if (user.length !== 1) die(`${user.length} accounts for that email`)
const { id: userId, version_seq: head } = user[0]

const plan = []
for (const p of prefixes) {
  const rows = d1(`SELECT id, data, deleted_at, server_version FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id LIKE ${sq(p + '%')}`)
  if (rows.length !== 1) die(`${p}: ${rows.length} tasks match, need exactly 1`)
  const r = rows[0]
  if (r.deleted_at) die(`${p}: the task is deleted`)
  const data = JSON.parse(r.data)
  if (data.state === state) { console.log(`${p}: already ${state}, skipped`); continue }
  const next = { ...data, state, updatedAt: new Date().toISOString() } // key order is kept: equal content must be equal text
  if (state !== 'open') next.followUpOn = null // only an open task carries a follow-up date (src/domain/records.ts)
  plan.push({ p, id: r.id, from: data.state, text: String(data.text).slice(0, 50), version: r.server_version, json: JSON.stringify(next) })
}

console.log(`account head ${head}; ${where.slice(2)}; ${plan.length} change(s):`)
for (const t of plan) console.log(`  ${t.p} v${t.version} ${t.from} -> ${state}  "${t.text}"`)
if (!plan.length) process.exit(0)
if (!apply) { console.log('dry run: nothing written. Add --apply to write.'); process.exit(0) }

const now = Date.now()
const sql = plan.flatMap((t) => [
  `UPDATE users SET version_seq = version_seq + 1 WHERE id = ${sq(userId)};`,
  `INSERT OR IGNORE INTO record_revisions (user_id, kind, id, server_version, data, deleted_at, replaced_at) SELECT user_id, kind, id, server_version, data, deleted_at, ${now} FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id = ${sq(t.id)} AND server_version = ${t.version};`,
  `UPDATE records SET data = ${sq(t.json)}, server_version = (SELECT version_seq FROM users WHERE id = ${sq(userId)}), received_at = ${now} WHERE user_id = ${sq(userId)} AND kind = 'task' AND id = ${sq(t.id)} AND server_version = ${t.version};`,
]).join('\n')

const dir = mkdtempSync(join(tmpdir(), 'task-state-'))
const file = join(dir, 'batch.sql')
writeFileSync(file, sql)
try {
  execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--file', file], { cwd: apiDir, stdio: ['ignore', 'inherit', 'inherit'] })
} finally { rmSync(dir, { recursive: true, force: true }) }

// Verify from outside the write: the rows must now read the target state on a version above the old head.
let bad = 0
for (const t of plan) {
  const r = d1(`SELECT data, server_version FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id = ${sq(t.id)}`)[0]
  const ok = r && JSON.parse(r.data).state === state && r.server_version > head
  if (!ok) bad++
  console.log(`  ${t.p} ${ok ? 'OK' : 'NOT APPLIED (the row moved; run again)'}${r ? ` v${r.server_version}` : ''}`)
}
const after = d1(`SELECT version_seq FROM users WHERE id = ${sq(userId)}`)[0].version_seq
console.log(`head ${head} -> ${after}`)
process.exit(bad ? 2 : 0)
