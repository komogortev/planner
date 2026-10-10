import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth, sessionUser } from './auth'
import { appOrigins } from './config'

export interface Env {
  DB: D1Database
  ALLOWED_APP_URLS: string
  ALLOWED_EMAILS: string
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

app.route('/auth', auth)

app.get('/me', async (c) => {
  const user = await sessionUser(c)
  return user ? c.json(user) : c.json({ error: 'signed out' }, 401)
})

export default app
