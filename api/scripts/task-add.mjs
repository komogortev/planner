#!/usr/bin/env node
// Add one Task to an account from outside the app (D-141), e.g. from the weekly Gmail triage. Written to D1 the way the push
// route writes a new record (api/src/records.ts); every device pulls it on its next sync.
//
//   node scripts/task-add.mjs <email> --source gmail:<threadId> --text "Contact the municipality for details" [--due YYYY-MM-DD] [--remote] [--apply]
//
// Dry run by default: it reads the account, prints the task it would create and writes nothing. --apply writes it.
// The task id is derived from --source, so a second run for the same email finds the first task and writes nothing, even
// when the owner has since finished or deleted it (a deleted task is never brought back). An open task with the same text
// (typed in by hand) also stops it. Exit 0 = added (or would add, dry run) · 3 = already there, nothing written ·
// 1 = refused input · 2 = the write did not land. Local D1 by default; production needs --remote. Needs Node 22.18+ (it imports the app's
// TypeScript domain code directly). Emails, ids and texts are typed here, never committed (public repo).
import { execFileSync } from 'node:child_process'
import { createRequire, registerHooks } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The domain code imports its siblings without an extension (bundler style); let Node find the `.ts` file.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, ctx)
      throw e
    }
  },
})
const { planTaskAdd, sameOpenTask, insertStatements, sq } = await import('./taskAdd.ts')

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js')

const args = process.argv.slice(2)
const VALUED = ['--source', '--text', '--due']
const flag = (n) => args.includes(n)
const opt = (n) => {
  const i = args.indexOf(n)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) { console.error(`${n} needs a value`); process.exit(1) }
  return v
}
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]))
const where = flag('--remote') ? '--remote' : '--local'
const apply = flag('--apply')

const die = (m) => { console.error(m); process.exit(1) }
const email = (positional[0] ?? '').trim().toLowerCase()
if (positional.length !== 1) die('name exactly one account email')
if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) die(`not an email: ${positional[0]}`)
const source = opt('--source') ?? ''
const text = opt('--text') ?? ''
const due = opt('--due') ?? null

const planned = planTaskAdd({ source, text, due, now: new Date().toISOString() })
if (!planned.ok) die(planned.error)
const plan = planned.value

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--json', '--command', sql], { cwd: apiDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  return JSON.parse(out)[0].results ?? []
}

const user = d1(`SELECT id, version_seq FROM users WHERE email = ${sq(email)}`)
if (user.length !== 1) die(`${user.length} accounts for that email`)
const { id: userId, version_seq: head } = user[0]

const show = `"${plan.fields.text}"${plan.fields.due ? ` due ${plan.fields.due}` : ''}`
console.log(`account head ${head}; ${where.slice(2)}; source ${source} -> task ${plan.id}`)

const existing = d1(`SELECT data, deleted_at, server_version FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id = ${sq(plan.id)}`)[0]
if (existing) {
  const state = existing.deleted_at ? 'deleted' : JSON.parse(existing.data).state
  console.log(`already added (v${existing.server_version}, ${state}): nothing to do`)
  process.exit(3)
}
const open = d1(`SELECT id, data FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND deleted_at IS NULL AND json_extract(data, '$.state') = 'open'`)
const twin = sameOpenTask(plan, open)
if (twin) {
  console.log(`an open task already says ${show} (${twin.slice(0, 8)}): nothing to do`)
  process.exit(3)
}

console.log(`would add: ${show}`)
console.log(`  ${plan.data}`)
if (!apply) { console.log('dry run: nothing written. Add --apply to write.'); process.exit(0) }

const dir = mkdtempSync(join(tmpdir(), 'task-add-'))
const file = join(dir, 'batch.sql')
writeFileSync(file, insertStatements(userId, plan, Date.now()).join('\n'))
try {
  execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--file', file], { cwd: apiDir, stdio: ['ignore', 'inherit', 'inherit'] })
} finally { rmSync(dir, { recursive: true, force: true }) }

// Verify from outside the write: the row must hold exactly the planned text on a version above the old head.
const r = d1(`SELECT data, server_version FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id = ${sq(plan.id)}`)[0]
const ok = r && r.data === plan.data && r.server_version > head
console.log(ok ? `OK v${r.server_version}` : `NOT APPLIED${r ? ` (row holds v${r.server_version}, other content)` : ' (no row)'}`)
process.exit(ok ? 0 : 2)
