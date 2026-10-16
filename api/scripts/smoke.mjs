#!/usr/bin/env node
// Smoke test a running app + API, from outside, the way a browser sees them. Read-only: writes nothing anywhere.
//
//   node api/scripts/smoke.mjs            production (Pages + workers.dev)
//   node api/scripts/smoke.mjs --local    local dev (app :5176, api :8787 — start both launch configs first)
//   node api/scripts/smoke.mjs --rate-limit   also trip the /auth/* limit on purpose (known positive for the deployed
//                                         limiter; this address is refused on /auth for ~1 minute afterwards). Production only.
//
// Every check has an expected outcome; the negative controls (refusals) matter as much as the passes.

const local = process.argv.includes('--local')
// --app=<url> points the production run at another origin (the Cloudflare Pages one: --app=https://koplanner.pages.dev/).
const appArg = process.argv.find((a) => a.startsWith('--app='))?.slice(6)
const APP = local ? 'http://localhost:5176/planner/' : appArg ?? 'https://koplanner.pages.dev/'
const API = local ? 'http://localhost:8787' : 'https://planner-api.komogortev.workers.dev'
const ORIGIN = new URL(APP).origin
// The origin the app left (docs/ORIGIN-MOVE.md phase 5): the Worker must refuse it. Known negative for the allow-list.
const RETIRED = 'https://komogortev.github.io/planner/'
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
  // Proves the gate only: a Worker without G1 answers 401 here too (/me's middleware). The deploy is proved by the
  // deployment tag and `d1 migrations list --remote` showing 0011, and the route by a real connect.
  ['/me/integrations/github without a token → 401 (gated)', async () => (await fetch(`${API}/me/integrations/github`)).status === 401],
  ['sign-in start, valid → 302 to the provider', async () => {
    const r = await fetch(`${API}/auth/start/github?return_to=${enc(APP)}&nonce=${NONCE}`, { redirect: 'manual' })
    return r.status === 302 && new URL(r.headers.get('location')).host === 'github.com'
  }],
  ['sign-in start, no nonce → 400', async () => (await fetch(`${API}/auth/start/github?return_to=${enc(APP)}`, { redirect: 'manual' })).status === 400],
  // A sibling path counts as foreign only when the app lives under a path (local dev); a dedicated origin is allowed whole.
  ['sign-in start, foreign host return_to → 400', async () => {
    const other = `https://evil.example/someone-else/`
    return (await fetch(`${API}/auth/start/github?return_to=${enc(other)}&nonce=${NONCE}`, { redirect: 'manual' })).status === 400
  }],
  ['sign-in start, lookalike of the app host → 400', async () => {
    const other = `${ORIGIN}.evil.example/`
    return (await fetch(`${API}/auth/start/github?return_to=${enc(other)}&nonce=${NONCE}`, { redirect: 'manual' })).status === 400
  }],
  ...(new URL(APP).pathname === '/' ? [] : [['sign-in start, sibling path on the shared origin → 400', async () => {
    const other = `${ORIGIN}/someone-else/`
    return (await fetch(`${API}/auth/start/github?return_to=${enc(other)}&nonce=${NONCE}`, { redirect: 'manual' })).status === 400
  }]]),
  ['sign-in callback, no flow → 302 back to the app with #error=expired (D-57)', async () => {
    const r = await fetch(`${API}/auth/callback/github?code=x&state=${'a'.repeat(43)}`, { redirect: 'manual' })
    const to = r.headers.get('location') ?? ''
    return r.status === 302 && to.startsWith(APP) && to.includes('#error=expired')
  }],
  ...(local ? [] : [
    ['sign-in start, the retired origin → 400', async () =>
      (await fetch(`${API}/auth/start/github?return_to=${enc(RETIRED)}&nonce=${NONCE}`, { redirect: 'manual' })).status === 400],
    ['CORS refuses the retired origin', async () =>
      (await fetch(`${API}/health`, { headers: { Origin: new URL(RETIRED).origin } })).headers.get('access-control-allow-origin') === null],
  ]),
  ['CORS admits the app origin', async () => {
    const r = await fetch(`${API}/health`, { headers: { Origin: ORIGIN } })
    return r.headers.get('access-control-allow-origin') === ORIGIN
  }],
  ['CORS refuses another origin', async () => {
    const r = await fetch(`${API}/health`, { headers: { Origin: 'https://evil.example' } })
    return r.headers.get('access-control-allow-origin') === null
  }],
  ['logout without a session → 204 (idempotent)', async () => (await fetch(`${API}/auth/logout`, { method: 'POST' })).status === 204],
  ...(process.argv.includes('--rate-limit') && !local ? [['rate limit: /auth/* answers 429 + Retry-After once this address is over', async () => {
    // Limit is 20/min per address (wrangler.toml). A no-session logout is a harmless no-op. Without a 429 the binding is
    // either not enforcing (plan or config) or the address header is missing — both are a failed deploy, not a pass.
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${API}/auth/logout`, { method: 'POST' })
      if (r.status === 429) return r.headers.get('retry-after') === '60'
    }
    throw new Error('40 requests, no 429')
  }]] : []),
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
