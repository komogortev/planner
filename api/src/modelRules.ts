// What a registered model may hold (H5-MODELS §5, §6). Pure validation, shared by the routes and the tests.

export const FORMATS = ['openai-chat', 'anthropic-messages'] as const
export type Format = (typeof FORMATS)[number]
export const isFormat = (v: unknown): v is Format => typeof v === 'string' && (FORMATS as readonly string[]).includes(v)

export const MODEL_ID = /^[a-z0-9-]{1,64}$/ // the row id, chosen by the device (same shape as record ids)
const PROVIDER_MODEL = /^[A-Za-z0-9._:/@-]{1,100}$/ // e.g. `claude-opus-5-5`, `gemini-3.1-flash-lite`, `org/model:tag`
export const MAX_TOKENS_CAP = 64_000
export const KEY_MAX_CHARS = 400

/**
 * The endpoint a key may be sent to: https only, no user info, a hostname that is a name (not an IP literal, not
 * localhost), no query or fragment. Returns the normalised URL without a trailing slash, or null. A path is allowed
 * (`…/v1beta/openai`). This is what keeps a stored key from being pointed at an address the user did not mean (D-84).
 */
export function cleanBaseUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 200) return null
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return null
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null // IPv4 / IPv6 literal
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

export interface ModelInput {
  label: string
  format: Format
  baseUrl: string
  model: string
  maxTokens: number
  key: string | null // null: keep the stored key (unless format or base URL change, which clears it)
}

/** The PUT body → a model, or the first error. Every field but `key` is required: a partial edit must not wipe fields. */
export function cleanModelInput(body: unknown): { ok: true; value: ModelInput } | { ok: false; error: string } {
  const b = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  if (!b) return { ok: false, error: 'body: not an object' }
  const label = typeof b.label === 'string' ? b.label.trim() : ''
  if (label.length < 1 || label.length > 60) return { ok: false, error: 'label: 1–60 characters' }
  if (!isFormat(b.format)) return { ok: false, error: `format: one of ${FORMATS.join(', ')}` }
  const baseUrl = cleanBaseUrl(b.baseUrl)
  if (!baseUrl) return { ok: false, error: 'baseUrl: an https address with a host name (no IP, no localhost, no query)' }
  if (typeof b.model !== 'string' || !PROVIDER_MODEL.test(b.model)) return { ok: false, error: 'model: the provider\'s model id' }
  if (!Number.isInteger(b.maxTokens) || (b.maxTokens as number) < 256 || (b.maxTokens as number) > MAX_TOKENS_CAP) {
    return { ok: false, error: `maxTokens: an integer from 256 to ${MAX_TOKENS_CAP}` }
  }
  let key: string | null = null
  if (b.key !== undefined && b.key !== null) {
    if (typeof b.key !== 'string') return { ok: false, error: 'key: text' }
    key = b.key.trim()
    if (key.length < 8 || key.length > KEY_MAX_CHARS || /\s/.test(key)) return { ok: false, error: 'key: 8–400 characters, no spaces' }
  }
  return { ok: true, value: { label, format: b.format, baseUrl, model: b.model, maxTokens: b.maxTokens as number, key } }
}
