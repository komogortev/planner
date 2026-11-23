#!/usr/bin/env node
// Read-only: write the planner export of one account to a local file, with no phone and no session token.
//
//   node api/scripts/export-local.mjs <email> [--remote] [--out <dir>] [--max-age-hours <h>]
//
// Reads D1 through `wrangler d1 execute planner --json` (SELECT only: export-core.mjs refuses anything else) and writes
// `planner-export-YYYY-MM-DD.json` (local day) to <dir>, default ~/Downloads: the same file Settings → Export downloads,
// plus `version_seq` (the account's head). Local D1 by default; production needs --remote, which first checks that the
// wrangler login can see the account that owns the planner database (it once lost it, 2026-11-07) and pins that account.
// Prints counts only, never content. The email is typed here, never committed (public repo).
//
// --max-age-hours <h>: pull only when the newest planner export in <dir> (by its `exportedAt`) is older than h hours, so
// a consumer can call this before every read (INBOX 7f3d9b02: freshness at read time, no scheduler). On any failure the
// last line is `STALE: …` with the age of the file a consumer would fall back on, so a failed pull is never silent.
//
// Exit: 0 written · 1 usage or wrangler failure · 2 no account has that email · 3 the planner account is not visible.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ageText, buildExport, exportFileName, freshness, NoAccountError } from './export-core.mjs'

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const remote = args.includes('--remote')
const outDir = resolve(opt('--out') ?? join(homedir(), 'Downloads'))
const [rawEmail] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--max-age-hours')
const maxAgeRaw = opt('--max-age-hours')

// The exports already in <dir> as { name, exportedAt } (unreadable files left out): what a consumer reads if this run writes nothing.
const existing = () => {
  let names = []
  try { names = readdirSync(outDir).filter((n) => /^planner-export-.*\.json$/.test(n)) } catch { /* no folder: no file */ }
  return names.flatMap((name) => {
    try { return [{ name, exportedAt: JSON.parse(readFileSync(join(outDir, name), 'utf8')).exportedAt }] } catch { return [] }
  })
}
const staleLine = () => {
  const f = freshness(existing(), {})
  return f.newest ? `STALE: nothing pulled; the newest export is ${f.newest}, ${ageText(f.ageMs)} old (${outDir})` : `STALE: nothing pulled and no planner export in ${outDir}`
}
const die = (m, code = 1) => { console.error(m); console.error(staleLine()); process.exit(code) }
const email = (rawEmail ?? '').trim().toLowerCase()
if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) die(`usage: node api/scripts/export-local.mjs <email> [--remote] [--out <dir>] [--max-age-hours <h>]\nnot an email: ${rawEmail ?? '(none)'}`)

if (maxAgeRaw !== undefined) {
  const hours = Number(maxAgeRaw)
  if (!(hours >= 0)) die(`--max-age-hours: not a number of hours: ${maxAgeRaw}`)
  const f = freshness(existing(), { maxAgeMs: hours * 3_600_000 })
  if (f.fresh) {
    console.log(`fresh: ${f.newest} is ${ageText(f.ageMs)} old (max ${hours} h), no pull · ${join(outDir, f.newest)}`)
    process.exit(0)
  }
  console.log(f.newest ? `${f.newest} is ${ageText(f.ageMs)} old (max ${hours} h): pulling` : `no planner export in ${outDir}: pulling`)
}

// Resolved after the freshness check, so a fresh file is reported even where api/ has no node_modules (a new worktree).
let wrangler
try { wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js') } catch {
  die(`wrangler is not installed under ${apiDir}: run \`pnpm --dir api install\``)
}

const run = (argv, env = process.env) =>
  execFileSync(process.execPath, [wrangler, ...argv], { cwd: apiDir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })

let env = process.env
if (remote) {
  // The planner database's id, from the same config the Worker deploys with.
  const dbId = readFileSync(join(apiDir, 'wrangler.toml'), 'utf8').match(/database_name\s*=\s*"planner"[^[]*?database_id\s*=\s*"([0-9a-f-]+)"/)?.[1]
  if (!dbId) die('wrangler.toml: no database_id for "planner"')
  let who
  try { who = JSON.parse(run(['whoami', '--json'])) } catch { die('wrangler whoami failed: not logged in? Run `pnpm --dir api exec wrangler login`.', 3) }
  const accounts = (who.accounts ?? []).filter((a) => !process.env.CLOUDFLARE_ACCOUNT_ID || a.id === process.env.CLOUDFLARE_ACCOUNT_ID)
  console.log(`wrangler whoami: ${who.loggedIn ? 'logged in' : 'NOT logged in'} (${who.authType}), ${accounts.length} account(s): ${accounts.map((a) => a.name).join('; ')}`)
  // `d1 list` per account: the one whose list holds the planner database is the planner account. Two visible accounts also
  // make every non-interactive wrangler call fail unless CLOUDFLARE_ACCOUNT_ID names one, so the match is pinned below.
  const owner = accounts.find((a) => {
    try { return JSON.parse(run(['d1', 'list', '--json'], { ...process.env, CLOUDFLARE_ACCOUNT_ID: a.id })).some((d) => d.uuid === dbId) } catch { return false }
  })
  if (!owner) die(`the planner account is not visible: no account of this login lists D1 ${dbId}. Run \`pnpm --dir api exec wrangler login\` with the account that owns it.`, 3)
  console.log(`planner account: ${owner.name} (…${owner.id.slice(-6)}) holds D1 planner`)
  env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: owner.id }
}

const query = async (sql) => {
  const out = run(['d1', 'execute', 'planner', remote ? '--remote' : '--local', '--json', '--command', sql], env)
  return JSON.parse(out)[0].results ?? []
}

let data
try {
  data = await buildExport(query, email)
} catch (err) {
  if (err instanceof NoAccountError) die(`${err.message}; nothing written`, 2)
  die(`export failed, nothing written: ${err.stderr?.toString().trim() || err.message}`)
}

mkdirSync(outDir, { recursive: true })
const file = join(outDir, exportFileName(new Date(data.exportedAt)))
writeFileSync(`${file}.part`, JSON.stringify(data, null, 2)) // a half-written file is never left under the real name
renameSync(`${file}.part`, file)

const kinds = {}
for (const r of data.records) kinds[r.recordKind] = (kinds[r.recordKind] ?? 0) + 1
console.log(`${remote ? 'remote' : 'local'} · version_seq ${data.version_seq} · entries ${data.entries.length} (revisions ${data.revisions.length}) · records ${data.records.length} (revisions ${data.recordRevisions.length}) · ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || 'no records'}`)
console.log(`wrote ${file}`)
