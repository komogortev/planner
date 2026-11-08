#!/usr/bin/env node
// Add one Task to an account from outside the app (D-141), e.g. from the weekly Gmail triage. Written to D1 the way the push
// route writes a new record (api/src/records.ts); every device pulls it on its next sync.
//
//   node scripts/task-add.mjs <email> --source gmail:<threadId> --text "Contact the municipality for details" [--due YYYY-MM-DD] [--remote] [--apply]
//   node scripts/task-add.mjs <email> --from tasks.json [--remote] [--apply]      (a list: [{ "source", "text", "due"? }])
//
// Dry run by default: it reads the account, prints the task it would create and writes nothing. --apply writes it.
// The task id is derived from --source, so a second run for the same email finds the first task and writes nothing, even
// when the owner has since finished or deleted it (a deleted task is never brought back). An open task with the same text
// (typed in by hand) also stops it. Exit 0 = added (or would add, dry run) · 3 = already there, nothing written ·
// 1 = refused input · 2 = the write did not land. Local D1 by default; production needs --remote. Needs Node 22.18+ (it imports the app's
// TypeScript domain code directly). Emails, ids and texts are typed here, never committed (public repo).
import { execFileSync } from 'node:child_process'
import { createRequire, registerHooks } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
const VALUED = ['--source', '--text', '--due', '--from']
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

// One task from the flags, or a list from `--from <file.json>`: [{ "source", "text", "due"? }, ...]. Kept outside the repo.
const from = opt('--from')
let inputs
if (from) {
  if (opt('--source') || opt('--text') || opt('--due')) die('--from replaces --source, --text and --due')
  try { inputs = JSON.parse(readFileSync(from, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { die(`${from}: ${e.message}`) }
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 50) die(`${from}: needs a list of 1-50 tasks`)
} else {
  inputs = [{ source: opt('--source') ?? '', text: opt('--text') ?? '', due: opt('--due') ?? null }]
}
const now = new Date().toISOString()
const plans = inputs.map((x, i) => {
  const p = planTaskAdd({ source: String(x?.source ?? ''), text: String(x?.text ?? ''), due: x?.due ?? null, now })
  if (!p.ok) die(`#${i + 1}: ${p.error}`)
  return { n: i + 1, source: x.source, ...p.value }
})
const ids = plans.map((p) => p.id)
if (new Set(ids).size !== ids.length) die('the same source appears twice')

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--json', '--command', sql], { cwd: apiDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  return JSON.parse(out)[0].results ?? []
}

const user = d1(`SELECT id, version_seq FROM users WHERE email = ${sq(email)}`)
if (user.length !== 1) die(`${user.length} accounts for that email`)
const { id: userId, version_seq: head } = user[0]
console.log(`account head ${head}; ${where.slice(2)}; ${plans.length} task(s) asked`)

const idList = ids.map(sq).join(', ')
const existing = new Map(d1(`SELECT id, data, deleted_at, server_version FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id IN (${idList})`).map((r) => [r.id, r]))
const open = d1(`SELECT id, data FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND deleted_at IS NULL AND json_extract(data, '$.state') = 'open'`)

const todo = []
for (const p of plans) {
  const show = `"${p.fields.text}"${p.fields.due ? ` due ${p.fields.due}` : ''}`
  const e = existing.get(p.id)
  if (e) { console.log(`  #${p.n} skip, already added (v${e.server_version}, ${e.deleted_at ? 'deleted' : JSON.parse(e.data).state}): ${show}`); continue }
  const twin = sameOpenTask(p, open)
  if (twin) { console.log(`  #${p.n} skip, an open task already says it (${twin.slice(0, 8)}): ${show}`); continue }
  console.log(`  #${p.n} add ${p.id.slice(0, 8)} [${p.source}] ${show}`)
  open.push({ id: p.id, data: p.data }) // the same text twice in one list is added once
  todo.push(p)
}
if (!todo.length) { console.log('nothing to add'); process.exit(3) }
if (!apply) { console.log(`dry run: ${todo.length} to add, nothing written. Add --apply to write.`); process.exit(0) }

const dir = mkdtempSync(join(tmpdir(), 'task-add-'))
const file = join(dir, 'batch.sql')
const receivedAt = Date.now()
writeFileSync(file, todo.flatMap((p) => insertStatements(userId, p, receivedAt)).join('\n'))
try {
  execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--file', file], { cwd: apiDir, stdio: ['ignore', 'inherit', 'inherit'] })
} finally { rmSync(dir, { recursive: true, force: true }) }

// Verify from outside the write: each row must hold exactly the planned text on a version above the old head.
const rows = new Map(d1(`SELECT id, data, server_version FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id IN (${todo.map((p) => sq(p.id)).join(', ')})`).map((r) => [r.id, r]))
let bad = 0
for (const p of todo) {
  const r = rows.get(p.id)
  const ok = r && r.data === p.data && r.server_version > head
  if (!ok) bad++
  console.log(`  #${p.n} ${ok ? `OK v${r.server_version}` : `NOT APPLIED${r ? ` (row holds v${r.server_version}, other content)` : ' (no row)'}`}`)
}
process.exit(bad ? 2 : 0)
