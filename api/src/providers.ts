// The two request formats a registered model can use (H5-MODELS D-81): plain fetch, no SDKs. This module turns a model
// row + key + prompt into one HTTP call and the answer into an outcome the rest of the Worker can store. It never logs and
// never returns a provider's error body: those can echo part of the key (D-88).
import { isFormat, type Format } from './modelRules'

export interface ModelTarget {
  format: Format
  baseUrl: string // validated by modelRules.cleanBaseUrl; no trailing slash
  model: string
  maxTokens: number
}

/** Every outcome a call can end in. `ok` and `cut_off` carry provider usage; only `ok` keeps the text. */
export type CallStatus =
  | 'ok'
  | 'cut_off' // the reply hit max tokens (D-85): refused before any parsing
  | 'refused' // the model declined (Anthropic `refusal`, OpenAI `content_filter`)
  | 'key_rejected'
  | 'rate_limited'
  | 'model_not_found'
  | 'model_unavailable' // an instant 503: this model is not available to this key (D-92)
  | 'provider_down'
  | 'bad_request'

export interface CallOutcome {
  status: CallStatus
  stop: string | null // the provider's own stop reason, verbatim (diagnosis)
  tokensIn: number | null
  tokensOut: number | null
  text: string // '' unless status is 'ok'
}

/** A 503 that comes back faster than this is a refusal to serve the model, not an overload mid-reply (H5-S1-SPIKE B). */
export const UNAVAILABLE_FAST_MS = 2_000

/** The request for one call. Pure: tests read it without a network. */
export function buildRequest(t: ModelTarget, key: string, prompt: string): { url: string; init: RequestInit } {
  const messages = [{ role: 'user', content: prompt }]
  if (t.format === 'anthropic-messages') {
    return {
      url: `${t.baseUrl}/messages`,
      init: {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: t.model, max_tokens: t.maxTokens, messages }),
        redirect: 'manual', // a redirect would carry the key to another host: a 3xx is an error, never followed
      },
    }
  }
  // OpenAI's own API takes `max_completion_tokens` for its current models; the compatibility layers measured so far
  // (Gemini) take `max_tokens`. Keyed on the host, not on the user: one less field to get wrong.
  const maxField = new URL(t.baseUrl).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens'
  return {
    url: `${t.baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.model, [maxField]: t.maxTokens, messages }),
      redirect: 'manual',
    },
  }
}

/** An HTTP failure → its category. Only the status code and elapsed time are read: the body is never looked at. */
export function errorStatus(http: number, elapsedMs: number): CallStatus {
  if (http === 401 || http === 403) return 'key_rejected'
  if (http === 404) return 'model_not_found'
  if (http === 429) return 'rate_limited'
  if (http === 503 && elapsedMs < UNAVAILABLE_FAST_MS) return 'model_unavailable'
  if (http >= 500) return 'provider_down' // incl. Anthropic's 529 "overloaded"
  return 'bad_request'
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null)

/**
 * The stop reasons that mean "finished". Everything else — `max_tokens`, `length`, a provider's own variant such as
 * `model_length` or `model_context_window_exceeded`, or none at all — is treated as cut off: an allowlist, so a truncation
 * spelled in a way not seen yet still keeps no text (D-85).
 */
const FINISHED: Record<Format, readonly string[]> = { 'anthropic-messages': ['end_turn', 'stop_sequence'], 'openai-chat': ['stop'] }

/** A 200 answer → outcome. Anything unreadable is `bad_request`: never guessed at, like the reply parsers (06 L5). */
export function readAnswer(format: Format, body: unknown): CallOutcome {
  const b = obj(body)
  const empty = (status: CallStatus, stop: string | null = null): CallOutcome => ({ status, stop, tokensIn: null, tokensOut: null, text: '' })
  if (!b) return empty('bad_request')
  if (format === 'anthropic-messages') {
    const stop = typeof b.stop_reason === 'string' ? b.stop_reason : null
    const usage = obj(b.usage)
    const base = { stop, tokensIn: num(usage?.input_tokens), tokensOut: num(usage?.output_tokens) }
    if (stop === 'refusal') return { ...base, status: 'refused', text: '' }
    if (stop === null || !FINISHED[format].includes(stop)) return { ...base, status: 'cut_off', text: '' }
    if (!Array.isArray(b.content)) return empty('bad_request', stop)
    // Thinking blocks are skipped: only `text` blocks are the answer.
    const text = b.content.map((c) => obj(c)).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c!.text as string).join('')
    return { ...base, status: 'ok', text }
  }
  const choice = Array.isArray(b.choices) ? obj(b.choices[0]) : null
  const usage = obj(b.usage)
  const stop = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  const base = { stop, tokensIn: num(usage?.prompt_tokens), tokensOut: num(usage?.completion_tokens) }
  if (!choice) return empty('bad_request')
  if (stop === 'content_filter') return { ...base, status: 'refused', text: '' }
  if (stop === null || !FINISHED[format].includes(stop)) return { ...base, status: 'cut_off', text: '' }
  const content = obj(choice.message)?.content
  // A string in every API measured; some compatibility layers send a list of text parts.
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((p) => obj(p)).filter((p) => typeof p?.text === 'string').map((p) => p!.text as string).join('') : null
  if (text === null) return empty('bad_request', stop)
  return { ...base, status: 'ok', text }
}

/** One call. `fetchFn` is the global fetch in production; tests pass a stub. Throws nothing: a network error is `provider_down`. */
export async function callModel(t: ModelTarget, key: string, prompt: string, fetchFn: typeof fetch = fetch): Promise<CallOutcome> {
  if (!isFormat(t.format)) return { status: 'bad_request', stop: null, tokensIn: null, tokensOut: null, text: '' }
  const { url, init } = buildRequest(t, key, prompt)
  const started = Date.now()
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch {
    return { status: 'provider_down', stop: null, tokensIn: null, tokensOut: null, text: '' }
  }
  if (!res.ok) {
    await res.body?.cancel() // read nothing of it (D-88)
    return { status: errorStatus(res.status, Date.now() - started), stop: null, tokensIn: null, tokensOut: null, text: '' }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { status: 'bad_request', stop: null, tokensIn: null, tokensOut: null, text: '' }
  }
  return readAnswer(t.format, body)
}
