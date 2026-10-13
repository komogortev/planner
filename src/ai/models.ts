// The user's registered models, the app half (H5-MODELS §6; api/src/models.ts, api/src/aiCalls.ts). Pure parts — presets,
// outcome wording — plus the thin Worker client. The key is sent once, on save, and never read back: the Worker answers
// with `hasKey` and the last 4 characters only.
import { API_URL, storedToken } from '@/auth/signIn'

export type Format = 'openai-chat' | 'anthropic-messages'

export interface ModelView {
  id: string
  label: string
  format: Format
  baseUrl: string
  model: string
  maxTokens: number
  hasKey: boolean
  keyHint: string | null
  createdAt: number
  updatedAt: number
}

/** Everything the Worker may answer for a call. `pending` covers the Worker's internal `calling` too. */
export type CallStatus =
  | 'pending' | 'ok' | 'cut_off' | 'refused' | 'key_rejected' | 'rate_limited' | 'model_not_found'
  | 'model_unavailable' | 'provider_down' | 'bad_request' | 'no_key' | 'lost'

export interface CallView {
  id: string
  modelId: string
  stage: 'harness' | 'widget' | 'test'
  runId: string | null
  status: CallStatus
  stop: string | null
  tokensIn: number | null
  tokensOut: number | null
  reply: string | null
  replyCleared: boolean
  startedAt: number
  finishedAt: number | null
}

export interface Preset {
  id: 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom'
  name: string
  format: Format
  baseUrl: string // '' for custom: the user types it
  model: string // a sensible default the user can change; a Test call decides whether it works (D-92)
  note?: string
}

// H5-MODELS §10 O2. Defaults: Gemini 3.1 Flash-Lite (H5-S1-SPIKE §5: 10 s and clean JSON on the free tier, where 3.5 Flash
// finished 1 of 7); Claude Opus 5.5 is Anthropic's current default model.
export const PRESETS: readonly Preset[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', format: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
  { id: 'openai', name: 'OpenAI', format: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: '' },
  {
    id: 'gemini', name: 'Google Gemini', format: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite',
    note: 'Gemini’s free tier may use what you send to improve Google’s products. Your notes go to Google on every run.',
  },
  { id: 'openrouter', name: 'OpenRouter', format: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'custom', name: 'Other (OpenAI-compatible)', format: 'openai-chat', baseUrl: '', model: '' },
]

/** The preset a saved model came from, for its label in the list; `custom` when the endpoint matches none. */
export function presetOf(m: Pick<ModelView, 'format' | 'baseUrl'>): Preset {
  return PRESETS.find((p) => p.id !== 'custom' && p.format === m.format && p.baseUrl === m.baseUrl) ?? PRESETS[PRESETS.length - 1]!
}

/** What a finished call means to the person, in one line. `ok` and `pending` are handled by the caller. */
export function outcomeText(status: CallStatus): string {
  switch (status) {
    case 'ok': return 'Done.'
    case 'pending': return 'Still working…'
    case 'cut_off': return 'The reply was cut off (it hit the model’s length limit). Nothing was kept. Try again, or add the model again with a higher max tokens.'
    case 'refused': return 'The model declined to answer. Nothing was kept.'
    case 'key_rejected': return 'The provider refused the key. Check it, or add the model again with a new key.'
    case 'rate_limited': return 'The provider says you are over its rate limit. Try again in a minute.'
    case 'model_not_found': return 'The provider does not know this model id.'
    case 'model_unavailable': return 'This model is not available to your key. Pick another model.'
    case 'provider_down': return 'The provider did not answer (busy or down). Try again later.'
    case 'bad_request': return 'The provider refused the request. Most often the key is wrong (Google answers a bad key this way); otherwise billing or limits on your provider account.'
    case 'no_key': return 'This model has no usable key. Add it again with its key.'
    case 'lost': return 'The call did not finish. Run it again.'
  }
}

// ── The Worker client ──────────────────────────────────────────────────────────────────────────────────────────────

export class ModelsError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

type Fetch = typeof fetch
export interface Client { fetchImpl?: Fetch; apiUrl?: string; token?: string | null }

async function request<T>(path: string, init: RequestInit, c: Client = {}): Promise<T> {
  const token = c.token === undefined ? storedToken() : c.token
  if (!token) throw new ModelsError('Sign in first.', 401)
  let res: Response
  try {
    res = await (c.fetchImpl ?? fetch)(`${c.apiUrl ?? API_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
    })
  } catch {
    throw new ModelsError('No connection to the server.', null)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const msg = res.status === 503 ? 'Models are not set up on the server yet.' : res.status === 401 ? 'Signed out. Sign in again.' : body.error ?? `HTTP ${res.status}`
    throw new ModelsError(msg, res.status)
  }
  return (await res.json()) as T
}

export interface ModelInput { label: string; format: Format; baseUrl: string; model: string; maxTokens: number; key?: string }

export const listModels = async (c?: Client) => (await request<{ models: ModelView[] }>('/me/models', { method: 'GET' }, c)).models
export const saveModel = (id: string, input: ModelInput, c?: Client) =>
  request<ModelView>(`/me/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }, c)
export const deleteModel = (id: string, c?: Client) => request<{ deleted: true }>(`/me/models/${encodeURIComponent(id)}`, { method: 'DELETE' }, c)
export const testModel = (id: string, c?: Client) => request<{ id: string }>(`/me/models/${encodeURIComponent(id)}/test`, { method: 'POST' }, c)
export interface StartInput { modelId: string; stage: 'harness' | 'widget'; runId: string; prompt: string; entryCount: number }
export const startCall = (input: StartInput, c?: Client) => request<{ id: string }>('/ai/calls', { method: 'POST', body: JSON.stringify(input) }, c)
export const getCall = (id: string, c?: Client, signal?: AbortSignal) => request<CallView>(`/ai/calls/${encodeURIComponent(id)}`, { method: 'GET', signal }, c)
export const markStored = (id: string, c?: Client) => request<{ stored: true }>(`/ai/calls/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ stored: true }) }, c)

/** Failed reads in a row that a poll rides out (a phone back from the background, a Worker deploy) before it gives up. */
export const POLL_RETRIES = 6

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
  })

/**
 * Polls a call until it is no longer pending. Every model call runs as a Workflow on the Worker (D-91), so this is the only
 * way to get its outcome. The Worker decides when a call is lost (16 min after its step claimed it, 30 min unclaimed) and
 * says so on the next read, so the client trusts that; `timeoutMs` is only a backstop past it. A network error or a 5xx is
 * retried up to POLL_RETRIES times in a row; a 401 or 404 ends the wait. An abort rejects at once — mid-sleep or mid-read —
 * and the call keeps running on the Worker.
 */
export async function awaitCall(
  id: string,
  o: { client?: Client; intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<CallView> {
  const interval = o.intervalMs ?? 2_500
  const deadline = Date.now() + (o.timeoutMs ?? 35 * 60_000)
  const sleep = o.sleep ?? abortableSleep
  let failures = 0
  for (;;) {
    o.signal?.throwIfAborted()
    let view: CallView
    try {
      view = await getCall(id, o.client, o.signal)
      failures = 0
    } catch (err) {
      o.signal?.throwIfAborted()
      const retriable = err instanceof ModelsError && (err.status === null || err.status >= 500)
      if (!retriable || ++failures > POLL_RETRIES) throw err
      await sleep(interval * failures, o.signal)
      continue
    }
    o.signal?.throwIfAborted()
    if (view.status !== 'pending') return view
    if (Date.now() >= deadline) return { ...view, status: 'lost' }
    await sleep(interval, o.signal)
  }
}
