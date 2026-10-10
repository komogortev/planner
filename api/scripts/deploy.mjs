#!/usr/bin/env node
// Guarded production deploy: the Worker and D1 schema in production always come from a commit on GitHub's `main`.
// Without this, `wrangler deploy` uploads whatever sits in the working folder — uncommitted edits, another branch —
// and Cloudflare records no source, so nothing would show that production runs code `main` does not contain.
//
//   pnpm --dir api run deploy              pending D1 migrations, then the Worker (tagged with the commit)
//   pnpm --dir api run db:migrate:remote   pending D1 migrations only
//
// Refuses unless: the working tree is clean (untracked files included), the branch is `main`, and it equals
// `origin/main` after a fetch. Order: merge the PR → run this.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js')
const migrateOnly = process.argv.includes('--migrate-only')

// trimEnd, not trim: `git status --porcelain` lines start with a status column that may be a space.
const git = (...args) => execFileSync('git', args, { cwd: apiDir, encoding: 'utf8' }).trimEnd()
function refuse(why, fix) {
  console.error(`deploy refused: ${why}\n  → ${fix}`)
  process.exit(1)
}

const dirty = git('status', '--porcelain')
if (dirty) refuse(`uncommitted or untracked files:\n${dirty.replace(/^/gm, '    ')}`, 'commit them through a PR, or stash them, then retry')
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') refuse(`on branch "${branch}", not main`, 'merge the PR, then: git switch main && git pull --ff-only')
git('fetch', '--quiet', 'origin', 'main')
const head = git('rev-parse', 'HEAD')
const remote = git('rev-parse', 'origin/main')
if (head !== remote) {
  const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').split(/\s+/)
  refuse(`local main is ${ahead} ahead / ${behind} behind origin/main`, 'git pull --ff-only (and never deploy unpushed commits)')
}

const sha = head.slice(0, 7)
const subject = git('log', '-1', '--format=%s')
console.log(`deploying ${sha} — ${subject}\n`)

const run = (args) => execFileSync(process.execPath, [wrangler, ...args], { cwd: apiDir, stdio: 'inherit' })
run(['d1', 'migrations', 'apply', 'planner', '--remote'])
if (!migrateOnly) run(['deploy', '--tag', sha, '--message', `${sha} ${subject}`.slice(0, 100)])
console.log(`\ndone: ${migrateOnly ? 'migrations' : 'migrations + Worker'} at ${sha}. Next: pnpm smoke`)
