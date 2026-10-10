import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth, sessionUser } from './auth'
import { appOrigins, appUrls } from './config'
import { envIcon } from '../../src/env/appEnv'

export interface Env {
  DB: D1Database
  ALLOWED_APP_URLS: string
  APP_ENV: 'local' | 'prod' // wrangler.toml says prod; the local `dev` script overrides it
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  const allowed = appOrigins(c.env)
  // Returning null leaves the allow-origin header off, so the browser refuses the response.
  return cors({ origin: (origin) => (allowed.includes(origin) ? origin : null), allowHeaders: ['Authorization', 'Content-Type'] })(c, next)
})

app.get('/health', (c) => c.json({ ok: true }))

// The tab icon for API pages (/health, …). Prod: the app's own favicon, unchanged. Local: the env-coloured `API` icon,
// so a local API tab differs from both the local app tab and anything in prod.
app.get('/favicon.ico', (c) => {
  // icon.svg: the artwork the app's own tab shows (index.html), so prod app and API tabs match. ALLOWED_APP_URLS ends
  // in `/` (the sign-in prefix check relies on that too). Anything but APP_ENV=local takes this, the prod default.
  if (c.env.APP_ENV !== 'local') return c.redirect(`${appUrls(c.env)[0]}icon.svg`, 302)
  return c.body(envIcon('local', 'api'), 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
})

app.route('/auth', auth)

app.get('/me', async (c) => {
  const user = await sessionUser(c)
  return user ? c.json(user) : c.json({ error: 'signed out' }, 401)
})

export default app
