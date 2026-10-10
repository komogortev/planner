// One cleaning + validation rule set (H1-ENTRIES.md §7). The app runs it before the outbox write for fast feedback;
// the Worker runs it again as the authority. Environment-free: no Dexie, Vue, DOM or Workers APIs.
//
// "Cleaning" normalises encoding and whitespace only. It never redacts or rewrites what the owner wrote (A1).
// Cleaning is idempotent: cleaning a cleaned entry changes nothing, so device and server store the same text.
import { BODY_MAX_CHARS, TAG_MAX_CHARS, TAGS_MAX, type EntryInput } from './entry'

/** An entry that went through `cleanEntry` — the only shape the Worker writes to D1. */
export type CleanEntry = EntryInput & { readonly __cleaned: true }
export type CleanResult = { ok: true; value: CleanEntry } | { ok: false; errors: string[] }

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// Built-in `cat-*` ids and uuids.
const CATEGORY_ID = /^[a-z0-9-]{1,64}$/
// C0 + DEL + C1 controls, except tab and newline. `\r` goes too, so a Windows "\r\n" arrives as "\n".
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g
// Tags are single-line: every control character goes, tab and newline included.
// eslint-disable-next-line no-control-regex
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/g
// Work is bounded before any normalisation: a body longer than this in UTF-16 units cannot be ≤ 20,000 characters
// after cleaning unless it is mostly control characters, and is refused without being processed.
const RAW_BODY_MAX_UNITS = BODY_MAX_CHARS * 4
// Every field a device sends. A missing key is an error, never a default: payloads are the full entry (§6.1), so an
// absent `deletedAt` cannot silently undelete and an absent `tags` cannot wipe them.
const FIELDS = ['id', 'body', 'createdAt', 'occurredAt', 'categoryId', 'tags', 'origin', 'updatedAt', 'deletedAt'] as const

/** Code points, counted without allocating; an emoji counts once. */
function charCount(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

/** False when the string holds an unpaired UTF-16 surrogate, which D1's UTF-8 storage cannot keep as written. */
export function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (d < 0xdc00 || d > 0xdfff) return false
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false
    }
  }
  return true
}

/** Body text as stored: controls stripped (tab/newline kept), then NFC, then trailing whitespace trimmed. */
export function cleanBody(raw: string): string {
  // Strip before normalising: a control between a letter and its combining mark would otherwise block composition.
  return raw.replace(CONTROL, '').normalize('NFC').trimEnd()
}

export function cleanTag(raw: string): string {
  // Lowercasing can de-normalise, so NFC comes after it.
  return raw.replace(CONTROL_ALL, '').toLowerCase().normalize('NFC').trim()
}

/** Real calendar date in `YYYY-MM-DD` (rejects 2026-02-30). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * Exactly what `Date.prototype.toISOString` writes: UTC, milliseconds, `Z`. Strict so that string order is time order
 * (D1 and Dexie index these as text) and so an engine that rolls 02-30 over to 03-02 cannot accept it.
 */
export function isIsoDateTime(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return false
  const d = new Date(s)
  return !Number.isNaN(d.getTime()) && d.toISOString() === s
}

/**
 * Validate and clean an entry as sent by a device. Every field must be present; unknown fields are dropped;
 * `serverVersion` and any owner field never pass through — the Worker takes the account from the session.
 * Error messages never quote the owner's text (they can reach logs).
 */
export function cleanEntry(input: unknown): CleanResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['not an object'] }
  const r = input as Record<string, unknown>
  const missing = FIELDS.filter((k) => !(k in r))
  if (missing.length) return { ok: false, errors: missing.map((k) => `${k}: missing`) }
  const errors: string[] = []
  const str = (v: unknown): v is string => typeof v === 'string' && isWellFormed(v)

  const id = str(r.id) ? r.id.toLowerCase() : ''
  if (!UUID_V4.test(id)) errors.push('id: not a uuid v4')

  let body = ''
  if (!str(r.body)) errors.push('body: not a well-formed string')
  else if (r.body.length > RAW_BODY_MAX_UNITS) errors.push(`body: over ${BODY_MAX_CHARS} characters`)
  else {
    body = cleanBody(r.body)
    const len = charCount(body)
    if (len === 0) errors.push('body: empty')
    if (len > BODY_MAX_CHARS) errors.push(`body: ${len} characters, limit ${BODY_MAX_CHARS}`)
  }

  for (const k of ['createdAt', 'updatedAt'] as const) {
    if (!(typeof r[k] === 'string' && isIsoDateTime(r[k] as string))) errors.push(`${k}: not an ISO datetime`)
  }
  if (r.deletedAt !== null && !(typeof r.deletedAt === 'string' && isIsoDateTime(r.deletedAt))) {
    errors.push('deletedAt: not an ISO datetime or null')
  }
  if (r.occurredAt !== null && !(typeof r.occurredAt === 'string' && isIsoDate(r.occurredAt))) {
    errors.push('occurredAt: not YYYY-MM-DD or null')
  }
  if (r.categoryId !== null && !(typeof r.categoryId === 'string' && CATEGORY_ID.test(r.categoryId))) {
    errors.push('categoryId: not a category id or null')
  }

  const tags: string[] = []
  if (!Array.isArray(r.tags)) errors.push('tags: not an array')
  else if (r.tags.length > TAGS_MAX * 4) errors.push(`tags: over ${TAGS_MAX}`) // bound the work before deduping
  else {
    const seen = new Set<string>()
    for (const t of r.tags) {
      if (!str(t)) { errors.push('tags: an item is not a well-formed string'); break }
      const tag = cleanTag(t)
      if (tag && !seen.has(tag)) { seen.add(tag); tags.push(tag) }
    }
    if (tags.length > TAGS_MAX) errors.push(`tags: ${tags.length}, limit ${TAGS_MAX}`)
    if (tags.some((t) => charCount(t) > TAG_MAX_CHARS)) errors.push(`tags: one is over ${TAG_MAX_CHARS} characters`)
  }

  if (r.origin !== 'author') errors.push('origin: only "author" in H1')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      id,
      body,
      createdAt: r.createdAt as string,
      occurredAt: r.occurredAt as string | null,
      categoryId: r.categoryId as string | null,
      tags,
      origin: 'author',
      updatedAt: r.updatedAt as string,
      deletedAt: r.deletedAt as string | null,
    } as CleanEntry,
  }
}
