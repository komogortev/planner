#!/usr/bin/env node
// Smoke test a running app + API, from outside, the way a browser sees them. Read-only: writes nothing anywhere.
//
//   node api/scripts/smoke.mjs            production (Pages + workers.dev)
//   node api/scripts/smoke.mjs --local    local dev (app :5176, api :8787 — start both launch configs first)
//
// Every check has an expected outcome; the negative controls (refusals) matter as much as the passes.

const local = process.argv.includes('--local')
const APP = local ? 'http://localhost:5176/planner/' : 'https://komogortev.github.io/planner/'
const API = local ? 'http://localhost:8787' : 'https://planner-api.komogortev.workers.dev'
const ORIGIN = new URL(APP).origin
const NONCE = 'smoketestnonce-0123456789'
const enc = encodeURIComponent

// Production only: is the deployed app the latest main? (Pages lags a merge by ~1 min; a stale tab or the installed
// app may lag further — that is the service worker, not the deploy.)
let mainCommit = ''
if (!local) {
  try {
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['fetch', '--quiet', 'origin', 'main'])
    mainCommit = execFileSync('git', ['rev-parse', '--short', 'origin/main'], { encoding: 'utf8' }).trim()
  } catch { /* no git here: the check reports it */ }
}

const checks = [
  ['app loads', async () => (await fetch(APP)).status === 200],
  ...(local ? [] : [[`deployed app is origin/main (${mainCommit || 'unknown'})`, async () => {
    const res = await fetch(`${APP}version.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error('no version.json — deployed before the version badge')
    const v = await res.json()
    if (v.commit !== mainCommit) throw new Error(`app is at ${v.commit} — Pages still deploying, or the merge did not deploy`)
    return true
  }]]),
  ['app deep link loads the app (SPA fallback)', async () => {
    const r = await fetch(`${APP}spike-auth`)
    return (await r.text()).includes('<div id="app">')
  }],
  ['api /health', async () => (await (await fetch(`${API}/health`)).json()).ok === true],
  ['/me without a token → 401', async () => (await fetch(`${API}/me`)).status === 401],
  ['/me with a bad token → 401', async () => (await fetch(`${API}/me`, { headers: { Authorization: 'Bearer nope' } })).status === 401],
  ['sign-in start, valid → 302 to the provider', async () => {
    const r = await fetch(`${API}/auth/start/github?return_to=${enc(APP)}&nonce=${NONCE}`, { redirect: 'manual' })
    return r.status === 302 && new URL(r.headers.get('location')).host === 'github.com'
  }],
  ['sign-in start, no nonce → 400', async () => (await fetch(`${API}/auth/start/github?return_to=${enc(APP)}`, { redirect: 'manual' })).status === 400],
  ['sign-in start, foreign return_to → 400', async () => {
    const other = `${ORIGIN}/someone-else/`
    return (await fetch(`${API}/auth/start/github?return_to=${enc(other)}&nonce=${NONCE}`, { redirect: 'manual' })).status === 400
  }],
  ['CORS admits the app origin', async () => {
    const r = await fetch(`${API}/health`, { headers: { Origin: ORIGIN } })
    return r.headers.get('access-control-allow-origin') === ORIGIN
  }],
  ['CORS refuses another origin', async () => {
    const r = await fetch(`${API}/health`, { headers: { Origin: 'https://evil.example' } })
    return r.headers.get('access-control-allow-origin') === null
  }],
  ['logout without a session → 204 (idempotent)', async () => (await fetch(`${API}/auth/logout`, { method: 'POST' })).status === 204],
]

console.log(`smoke: ${local ? 'LOCAL' : 'PRODUCTION'}\n  app ${APP}\n  api ${API}\n`)
let failed = 0
for (const [name, run] of checks) {
  let ok = false
  let note = ''
  try { ok = await run() } catch (e) { note = ` (${e.cause?.code ?? e.message})` }  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note}`)
}
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
