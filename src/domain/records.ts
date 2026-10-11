// The harness / widget record kinds as they travel and are stored (HW-HARNESS.md §5, D-62). One validation rule set,
// run by the app before the outbox write and again by the Worker as the authority — the same split as `clean.ts` for
// entries. Environment-free: no Dexie, Vue, DOM or Workers APIs.
//
// Wire form of one record: `{ id, ...the kind's own fields, deletedAt }`. A mutation names the kind in `recordKind`
// (distinct from the `kind` field some records carry themselves: a link's `closes | carries`, a widget's `system | prompt`).
// The validator drops unknown keys, never repairs a wrong one, and returns fields in a fixed order so equal content
// serialises to equal text (the Worker compares text to tell a replay from an edit).
import { cleanBody, isIsoDate, isIsoDateTime, isWellFormed } from './clean'
import type { Assessment, EntryState, Link, Question } from './harness'
import type { Report } from './journal'

export const RECORD_KINDS = ['assessment', 'question', 'link', 'entryState', 'widget', 'report', 'run'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]
export const isRecordKind = (v: unknown): v is RecordKind => typeof v === 'string' && (RECORD_KINDS as readonly string[]).includes(v)

/** Dexie table that holds each kind on the device. */
export const RECORD_TABLE = {
  assessment: 'assessments',
  question: 'questions',
  link: 'links',
  entryState: 'entryStates',
  widget: 'widgets',
  report: 'reports',
  run: 'runs',
} as const satisfies Record<RecordKind, string>

/** Ids are lowercase uuids, uuid v5 derivations or short built-in names such as `builtin-daily-task-journal`. */
export const RECORD_ID = /^[a-z0-9-]{1,64}$/
/** A record's own fields, serialised. Bounds what one row can cost to store and to ship. */
export const RECORD_DATA_MAX_BYTES = 65_536

/** The saved instruction inside a prompt widget (D-32); the built-in journal lens is one. */
export interface WidgetLens {
  id: string
  name: string
  version: number
  shape: 'markdown' | 'checklist' | 'table'
  instruction: string
}
export interface WidgetRecord {
  id: string
  name: string
  kind: 'system' | 'prompt'
  active: boolean
  lens: WidgetLens | null // a prompt widget has one, a system widget does not
  lineage: string | null // the widget this one was cloned from
  createdAt: string
  updatedAt: string
}
/** One composed prompt (the run header, A2), kept so any result can be explained. `id` is the run id. */
export interface RunRecord {
  id: string
  stage: 'harness' | 'widget'
  version: number // harnessVersion or lensVersion
  widgetId: string | null
  entryIds: string[]
  ranAt: string
  executor: 'copy-prompt'
}

/** Each kind's own fields (the domain types), before the sync fields are added. */
export interface RecordTypes {
  assessment: Assessment
  question: Question
  link: Link
  entryState: EntryState
  widget: WidgetRecord
  report: Report
  run: RunRecord
}

/** What every record row carries on the device in addition to its own fields. */
export interface SyncFields {
  deletedAt: string | null
  serverVersion: number | null // null until the backend has acknowledged it
}
/** What a device may send: everything except what the server stamps. */
export type RecordInput<T> = T & { deletedAt: string | null }

export type CleanRecord = {
  recordKind: RecordKind
  id: string
  deletedAt: string | null
  /** The kind's own fields in spec order, without `id` and `deletedAt`. */
  fields: Record<string, unknown>
}
export type CleanRecordResult = { ok: true; value: CleanRecord } | { ok: false; errors: string[] }

// ── Field checks ───────────────────────────────────────────────────────────────────────────────────────────────────

type Checked = { ok: true; value: unknown } | { ok: false; error: string }
type Check = (v: unknown) => Checked
const ok = (value: unknown): Checked => ({ ok: true, value })
const bad = (error: string): Checked => ({ ok: false, error })
const points = (s: string) => Array.from(s).length

const id: Check = (v) => {
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  return RECORD_ID.test(s) ? ok(s) : bad('is not an id')
}

/** One line: controls stripped, whitespace collapsed. Idempotent. */
const line = (min: number, max: number): Check => (v) => {
  if (typeof v !== 'string' || !isWellFormed(v)) return bad('is not text')
  const s = cleanBody(v).replace(/\s+/g, ' ').trim()
  const n = points(s)
  return n < min || n > max ? bad(`must be ${min}–${max} characters`) : ok(s)
}

/** Several lines: controls stripped (tab and newline kept), trimmed. Idempotent. */
const text = (min: number, max: number): Check => (v) => {
  if (typeof v !== 'string' || !isWellFormed(v)) return bad('is not text')
  const s = cleanBody(v).trim()
  const n = points(s)
  return n < min || n > max ? bad(`must be ${min}–${max} characters`) : ok(s)
}

const oneOf = (...values: string[]): Check => (v) => (typeof v === 'string' && values.includes(v) ? ok(v) : bad(`must be one of ${values.join(', ')}`))
const dateTime: Check = (v) => (typeof v === 'string' && isIsoDateTime(v) ? ok(v) : bad('is not a UTC date-time'))
const date: Check = (v) => (typeof v === 'string' && isIsoDate(v) ? ok(v) : bad('is not YYYY-MM-DD'))
const bool: Check = (v) => (typeof v === 'boolean' ? ok(v) : bad('is not true or false'))
const int = (min: number, max: number): Check => (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? ok(v) : bad(`must be a whole number ${min}–${max}`))
const nullable = (c: Check): Check => (v) => (v === null ? ok(null) : c(v))

const idList = (max: number): Check => (v) => {
  if (!Array.isArray(v) || v.length > max) return bad(`must be a list of at most ${max} ids`)
  const out: string[] = []
  for (const x of v) {
    const r = id(x)
    if (!r.ok) return bad('holds something that is not an id')
    out.push(r.value as string)
  }
  return ok(out)
}

/** An object with exactly these fields, in this order; unknown keys are dropped, a missing one is an error. */
const shape = (spec: Record<string, Check>): Check => (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad('is not an object')
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(spec)) {
    if (!(key in o)) return bad(`${key} is missing`)
    const r = check(o[key])
    if (!r.ok) return bad(`${key} ${r.error}`)
    out[key] = r.value
  }
  return ok(out)
}

const listOf = (item: Check, max: number): Check => (v) => {
  if (!Array.isArray(v) || v.length > max) return bad(`must be a list of at most ${max}`)
  const out: unknown[] = []
  for (const x of v) {
    const r = item(x)
    if (!r.ok) return bad(`holds an invalid item: ${r.error}`)
    out.push(r.value)
  }
  return ok(out)
}

// ── Kinds ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const LENS = shape({ id: id, name: line(1, 80), version: int(1, 1000), shape: oneOf('markdown', 'checklist', 'table'), instruction: text(1, 2000) })

const SPECS: Record<RecordKind, Record<string, Check>> = {
  assessment: { entryId: id, harnessVersion: int(1, 1000), runId: id, at: dateTime },
  question: {
    entryId: id, text: line(1, 200), state: oneOf('open', 'answered', 'dismissed'), answer: nullable(text(1, 2000)),
    createdAt: dateTime, answeredAt: nullable(dateTime), runId: id,
  },
  link: {
    fromEntryId: id, toEntryId: id, kind: oneOf('closes', 'carries'), onDate: nullable(date),
    state: oneOf('proposed', 'confirmed', 'rejected'), evidence: line(0, 200), runId: id,
  },
  entryState: { state: oneOf('open', 'done', 'dropped'), followUpOn: nullable(date), by: oneOf('owner', 'confirmed-proposal'), updatedAt: dateTime },
  widget: {
    name: line(1, 80), kind: oneOf('system', 'prompt'), active: bool, lens: nullable(LENS), lineage: nullable(id),
    createdAt: dateTime, updatedAt: dateTime,
  },
  report: {
    widgetId: id, lensVersion: int(1, 1000), runId: id, entryIds: idList(200), body: text(1, 10_000),
    citations: listOf(shape({ entryId: id, quote: line(1, 200) }), 200), executor: oneOf('copy-prompt'), ranAt: dateTime,
    origin: oneOf('ai-observation'), droppedCitations: int(0, 1000),
  },
  run: { stage: oneOf('harness', 'widget'), version: int(1, 1000), widgetId: nullable(id), entryIds: idList(200), ranAt: dateTime, executor: oneOf('copy-prompt') },
}

/** Cross-field rules a single-field check cannot see. Returns an error, or null. */
const RULES: Record<RecordKind, (f: Record<string, unknown>) => string | null> = {
  assessment: () => null,
  question: (f) => {
    const answered = f.state === 'answered'
    if (answered !== (f.answer !== null) || answered !== (f.answeredAt !== null)) return 'an answered question has an answer and a time, any other does not'
    return null
  },
  link: (f) => ((f.kind === 'carries') !== (f.onDate !== null) ? 'a carry has a date, a close does not' : null),
  entryState: (f) => (f.followUpOn !== null && f.state !== 'open' ? 'only an open note carries a follow-up date' : null),
  widget: (f) => ((f.kind === 'prompt') !== (f.lens !== null) ? 'a prompt widget has a lens, a system widget does not' : null),
  report: () => null,
  run: (f) => ((f.stage === 'widget') !== (f.widgetId !== null) ? 'a widget run names its widget, a harness run does not' : null),
}

/**
 * Validate one record as a device sends it. Every field must be present — an absent `deletedAt` must not silently
 * undelete, and a partial payload must not wipe fields — so a missing key is an error, never a default.
 */
export function cleanRecord(recordKind: unknown, input: unknown): CleanRecordResult {
  if (!isRecordKind(recordKind)) return { ok: false, errors: ['recordKind: unknown'] }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['payload: not an object'] }
  const o = input as Record<string, unknown>
  const errors: string[] = []
  if (!('id' in o)) errors.push('id: missing')
  if (!('deletedAt' in o)) errors.push('deletedAt: missing')
  if (errors.length) return { ok: false, errors }
  const recordId = id(o.id)
  if (!recordId.ok) errors.push(`id: ${recordId.error}`)
  const deletedAt = nullable(dateTime)(o.deletedAt)
  if (!deletedAt.ok) errors.push(`deletedAt: ${deletedAt.error}`)
  const fields: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(SPECS[recordKind])) {
    if (!(key in o)) {
      errors.push(`${key}: missing`)
      continue
    }
    const r = check(o[key])
    if (r.ok) fields[key] = r.value
    else errors.push(`${key}: ${r.error}`)
  }
  if (errors.length) return { ok: false, errors }
  const rule = RULES[recordKind](fields)
  if (rule) return { ok: false, errors: [rule] }
  if (new TextEncoder().encode(JSON.stringify(fields)).length > RECORD_DATA_MAX_BYTES) return { ok: false, errors: [`record: over ${RECORD_DATA_MAX_BYTES} bytes`] }
  return { ok: true, value: { recordKind, id: (recordId as { value: string }).value, deletedAt: (deletedAt as { value: string | null }).value, fields } }
}

/** The flat wire / device form of a validated record: `{ id, ...fields, deletedAt }`. */
export function flatten(r: CleanRecord): Record<string, unknown> {
  return { id: r.id, ...r.fields, deletedAt: r.deletedAt }
}
