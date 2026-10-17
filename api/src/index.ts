import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { meApi, signedOutBody } from './account'
import { aiCallsApi } from './aiCalls'
import { auth, sessionUser } from './auth'
import { appOrigins, appUrls } from './config'
import { logApi } from './log'
import { modelsApi } from './models'
import { runNightlyExport } from './nightlyExport'
import { runSchedules, schedulesApi } from './schedules'
import { sessionsApi } from './sessions'
import { integrationsApi } from './integrations'
import { projectsApi, reposApi } from './projects'
import { byIp } from './ratelimit'
import { entriesApi, sync } from './sync'
import { envIcon } from '../../src/env/appEnv'

export interface Env {
  DB: D1Database
  ALLOWED_APP_URLS: string
  APP_ENV: 'local' | 'prod' // wrangler.toml says prod; the local `dev` script overrides it
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  // Rate limits (src/ratelimit.ts); the numbers are in wrangler.toml.
  RL_AUTH_IP: RateLimit
  RL_PUSH_IP: RateLimit
  RL_PUSH_USER: RateLimit
  RL_AI_USER: RateLimit
  RL_LOG_IP: RateLimit
  // H5 (docs/H5-MODELS.md): the secret that encrypts users' model keys — optional in the type so a Worker without it
  // answers 503 'not configured' instead of failing at start; the Workflow every model call runs in; the daily call cap.
  MODEL_KEY_SECRET?: string
  MODEL_CALL: Workflow<import('./aiCalls').CallParams>
  AI_DAILY_CAP: string
  // R6 nightly export (src/nightlyExport.ts): the private data repo (wrangler.toml) and two secrets the owner sets — a
  // fine-grained token for that repo only (Contents: read and write) and the one account it exports (D-122 Q1).
  EXPORT_REPO?: string
  EXPORT_GITHUB_TOKEN?: string
  EXPORT_ACCOUNT_EMAIL?: string
  // H5 S3-1 (src/schedules.ts): the operator's brake, `true` stops every account's schedules (D-129). A var, not a secret.
  SCHEDULES_PAUSED?: string
}

/** Must equal the schedule tick in wrangler.toml. */
export const SCHEDULE_CRON = '5 * * * *'

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  const allowed = appOrigins(c.env)
  // Returning null leaves the allow-origin header off, so the browser refuses the response.
  return cors({ origin: (origin) => (allowed.includes(origin) ? origin : null), allowHeaders: ['Authorization', 'Content-Type'],
    // Not CORS-safelisted: without this the app on another origin cannot read how long a 429 asks it to wait.
    exposeHeaders: ['Retry-After'] })(c, next)
})

app.get('/health', (c) => c.json({ ok: true }))

// The tab icon for API pages (/health, …). Prod: the app's own favicon, unchanged. Local: the env-coloured `API` icon,
// so a local API tab differs from both the local app tab and anything in prod.
app.get('/favicon.ico', async (c) => {
  if (c.env.APP_ENV === 'local') {
    return c.body(envIcon('local', 'api'), 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
  }
  // Prod (and anything not `local`): the app's own icon.svg — the artwork its tab shows (index.html) — served as bytes.
  // Not a redirect: browsers did not follow a redirected /favicon.ico (prod tab showed a globe; the directly served
  // local icon showed). Edge-cached a day. ALLOWED_APP_URLS ends in `/` (the sign-in prefix check relies on it too).
  const res = await fetch(`${appUrls(c.env)[0]}icon.svg`, { cf: { cacheTtl: 86_400, cacheEverything: true } })
  if (!res.ok) return c.body(null, 404)
  return c.body(await res.arrayBuffer(), 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' })
})

app.use('/auth/*', byIp('RL_AUTH_IP'))
app.route('/auth', auth)
app.route('/sync', sync)
app.route('/entries', entriesApi)
app.route('/me/models', modelsApi)
app.route('/me/schedules', schedulesApi)
app.route('/me/sessions', sessionsApi)
app.route('/me/integrations/github/repos', reposApi) // before /me/integrations: the more specific mount first
app.route('/me/integrations', integrationsApi)
app.route('/projects', projectsApi)
app.route('/me', meApi)
app.route('/ai/calls', aiCallsApi)
app.route('/log', logApi)

app.get('/me', async (c) => {
  const user = await sessionUser(c)
  return user ? c.json(user) : c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
})

export default {
  fetch: app.fetch,
  // wrangler.toml [triggers]: the hourly schedule tick (D-132) and the nightly export (R6).
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(controller.cron === SCHEDULE_CRON ? runSchedules(env) : runNightlyExport(env))
  },
} satisfies ExportedHandler<Env>
export { ModelCallWorkflow } from './aiCalls'
