// /me/models — the models a user registered (H5-MODELS §6). The key goes in once and never comes back out: every response
// carries `hasKey` and the last 4 characters, nothing else of it (D-79). Tenant isolation as everywhere (A11): the user id
// comes from the session, every query binds it.
import { Hono } from 'hono'
import { signedOutBody } from './account'
import { authenticate, type AuthedSession } from './auth'
import { startCall } from './aiCalls'
import { KeyBoxUnavailable, sealKey } from './keyBox'
import { cleanModelInput, MODEL_ID } from './modelRules'
import type { Env } from './index'

export const MODELS_PER_USER = 10

export interface ModelRow {
  user_id: string; id: string; label: string; format: string; base_url: string; model: string; max_tokens: number
  key_ct: string | null; key_iv: string | null; key_hint: string | null; key_version: number | null; created_at: number; updated_at: number
}

/** The device's view of a model: everything but the key. The one function every response goes through. */
export const modelView = (r: ModelRow) => ({
  id: r.id, label: r.label, format: r.format, baseUrl: r.base_url, model: r.model, maxTokens: r.max_tokens,
  hasKey: r.key_ct !== null, keyHint: r.key_hint, createdAt: r.created_at, updatedAt: r.updated_at,
})

export const getModel = (db: D1Database, userId: string, id: string) =>
  db.prepare('SELECT * FROM models WHERE user_id = ? AND id = ?').bind(userId, id).first<ModelRow>()

type Vars = { session: AuthedSession }
export const modelsApi = new Hono<{ Bindings: Env; Variables: Vars }>()

modelsApi.use('*', async (c, next) => {
  const s = await authenticate(c.env.DB, c.req.header('Authorization'))
  if (!s) return c.json(await signedOutBody(c.env.DB, c.req.header('Authorization')), 401)
  c.set('session', s)
  await next()
})

modelsApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM models WHERE user_id = ? ORDER BY created_at').bind(c.get('session').id).all<ModelRow>()
  return c.json({ models: results.map(modelView) })
})

// PUT /me/models/:id { label, format, baseUrl, model, maxTokens, key? } — create or replace. Without `key`, the stored key
// stays only while format and base URL stay: an endpoint change clears it (D-84).
modelsApi.put('/:id', async (c) => {
  const userId = c.get('session').id
  const id = c.req.param('id')
  if (!MODEL_ID.test(id)) return c.json({ error: 'id: lowercase letters, digits and dashes' }, 400)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'not JSON' }, 400) }
  const input = cleanModelInput(body)
  if (!input.ok) return c.json({ error: input.error }, 400)
  const m = input.value
  const old = await getModel(c.env.DB, userId, id)
  const endpointKept = old !== null && old.format === m.format && old.base_url === m.baseUrl
  let key: { ct: string | null; iv: string | null; hint: string | null; version: number | null }
  if (m.key !== null) {
    try {
      key = await sealKey(c.env.MODEL_KEY_SECRET, m.key, userId, id, m.baseUrl)
    } catch (err) {
      if (err instanceof KeyBoxUnavailable) { console.error(`models: ${err.message}`); return c.json({ error: 'not configured' }, 503) }
      throw err
    }
  } else if (endpointKept) {
    key = { ct: old.key_ct, iv: old.key_iv, hint: old.key_hint, version: old.key_version }
  } else {
    key = { ct: null, iv: null, hint: null, version: null }
  }
  const now = Date.now()
  const args = [userId, id, m.label, m.format, m.baseUrl, m.model, m.maxTokens, key.ct, key.iv, key.hint, key.version, now] as const
  if (old) {
    await c.env.DB.prepare(
      `UPDATE models SET label = ?3, format = ?4, base_url = ?5, model = ?6, max_tokens = ?7, key_ct = ?8, key_iv = ?9, key_hint = ?10,
         key_version = ?11, updated_at = ?12 WHERE user_id = ?1 AND id = ?2`,
    ).bind(...args).run()
  } else {
    // The limit and the insert are one statement: parallel PUTs with new ids cannot all pass a count read first.
    const r = await c.env.DB.prepare(
      `INSERT INTO models (user_id, id, label, format, base_url, model, max_tokens, key_ct, key_iv, key_hint, key_version, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12 WHERE (SELECT COUNT(*) FROM models WHERE user_id = ?1) < ?13
       ON CONFLICT (user_id, id) DO NOTHING`,
    ).bind(...args, MODELS_PER_USER).run()
    if (!r.meta.changes) return c.json({ error: `at most ${MODELS_PER_USER} models` }, 409)
  }
  return c.json(modelView((await getModel(c.env.DB, userId, id))!))
})

modelsApi.delete('/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM models WHERE user_id = ? AND id = ?').bind(c.get('session').id, c.req.param('id')).run()
  return r.meta.changes ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404)
})

// POST /me/models/:id/test — a minimal call through the same path as a run (D-92: a test call, not the provider's model
// list, says whether a model is usable). Answers with a call id; the device reads the outcome from GET /ai/calls/:id.
export const TEST_PROMPT = 'Reply with the single word: ok'
modelsApi.post('/:id/test', async (c) => startCall(c, { modelId: c.req.param('id'), stage: 'test', runId: null, prompt: TEST_PROMPT, entryCount: 0 }))
