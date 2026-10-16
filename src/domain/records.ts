// The harness / widget record kinds as they travel and are stored (HW-HARNESS.md §5, D-62). One validation rule set,
// run by the app before the outbox write and again by the Worker as the authority — the same split as `clean.ts` for
// entries. Environment-free: no Dexie, Vue, DOM or Workers APIs.
//
// Wire form of one record: `{ id, ...the kind's own fields, deletedAt }`. A mutation names the kind in `recordKind`
// (distinct from the `kind` field some records carry themselves: a link's `closes | carries`, a widget's `system | prompt | project`).
// The validator drops unknown keys, never repairs a wrong one, and returns fields in a fixed order so equal content
// serialises to equal text (the Worker compares text to tell a replay from an edit).
import { cleanBody, isIsoDate, isIsoDateTime, isWellFormed } from './clean'
import type { Assessment, EntryState, Link, Question } from './harness'
import type { Report } from './journal'
import { MERGE_TASKS_MAX, SPLIT_PARTS_MAX, TASK_SOURCES_MAX, type Task, type TaskProposal } from './tasks'

export const RECORD_KINDS = ['assessment', 'question', 'link', 'entryState', 'widget', 'report', 'run', 'task', 'taskProposal'] as const
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
  task: 'tasks',
  taskProposal: 'taskProposals',
} as const satisfies Record<RecordKind, string>

/**
 * Fields added to a kind after it first shipped (S3 v2 S2, HW-HARNESS §11). A build from before them sends rows without
 * them, and the Worker keeps serving that build until it updates, so for these keys alone absence is accepted — and kept as
 * absence, never filled with a default: a default would change the stored text, and an older build's replay would then look
 * like an edit. On push, the Worker restores an absent one from the stored row (`restoreAbsent`): an older build drops keys it
 * does not know when it pulls, and its next edit must not erase them. Every other key stays required.
 */
export const ADDED_FIELDS: Partial<Record<RecordKind, readonly string[]>> = {
  assessment: ['taskId'],
  question: ['taskId', 'kind'],
  run: ['taskIds', 'modelId', 'callId'], // modelId, callId: H5 (H5-MODELS §5)
  widget: ['project', 'appearance'], // project: G2 (GITHUB-BRIDGE §5); appearance: C4 (the card's tint)
}

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
/** The GitHub repo a project widget shows (GITHUB-BRIDGE §5, G2). How the card looks is the repo's own `.planner.json`. */
export interface WidgetProject {
  repo: string // `owner/name`, as GitHub spells it
  private: boolean
}
/**
 * How a widget's card looks, chosen by the user (C4) and synced: the frost-glass tint. `tint` is a short id the app maps to
 * a palette; an id this build does not know shows the default glass, so a tint added later never makes an older build
 * reject the row.
 *
 * Rule for later: a new look setting is a new top-level ADDED_FIELD on the widget, never a key inside `appearance`. A build
 * that doesn't know a nested key drops it on pull and pushes `appearance` without it, and the Worker restores only absent
 * top-level keys, so the nested key would be erased.
 */
export interface WidgetAppearance {
  tint: string
}
export interface WidgetRecord {
  id: string
  name: string
  kind: 'system' | 'prompt' | 'project'
  active: boolean
  lens: WidgetLens | null // a prompt widget has one, a system or project widget does not
  lineage: string | null // the widget this one was cloned from
  /** A project widget's repo; null on every other kind. Absent on a row from before G2 (ADDED_FIELDS). */
  project?: WidgetProject | null
  /** The card's look (C4); null = the default glass. Absent on a row from before C4 (ADDED_FIELDS). */
  appearance?: WidgetAppearance | null
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
  executor: Executor
  taskIds?: string[] // S3 v2: every task the harness prompt carried; absent on a run stored before
  // H5: the registered model and its call (`/ai/calls`) when `executor` is 'model'; null for a copy-prompt run, absent on
  // a run stored before H5.
  modelId?: string | null
  callId?: string | null
}
/** What performed a run (VOCABULARY "Executor"): the owner's paste, or the user's registered model through the Worker (H5). */
export type Executor = 'copy-prompt' | 'model'

/** Each kind's own fields (the domain types), before the sync fields are added. */
export interface RecordTypes {
  assessment: Assessment
  question: Question
  link: Link
  entryState: EntryState
  widget: WidgetRecord
  report: Report
  run: RunRecord
  task: Task
  taskProposal: TaskProposal
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
  /** `ADDED_FIELDS` keys the payload did not have (an older build's row). Not in `fields`. */
  absent: string[]
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

/** GitHub's `owner/name`: an owner of 1–39 letters, digits or dashes; a repo name of letters, digits, `.`, `_`, `-`. */
export const REPO_FULL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
export const isRepoFullName = (v: unknown): v is string => typeof v === 'string' && REPO_FULL_NAME.test(v) && !v.endsWith('/.') && !v.endsWith('/..')
const repoName: Check = (v) => (isRepoFullName(v) ? ok(v) : bad('is not a GitHub owner/name'))
const PROJECT = shape({ repo: repoName, private: bool })
const TINT_ID: Check = (v) => (typeof v === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(v) ? ok(v) : bad('is not a tint id'))
const APPEARANCE = shape({ tint: TINT_ID })
const LENS = shape({ id: id, name: line(1, 80), version: int(1, 1000), shape: oneOf('markdown', 'checklist', 'table'), instruction: text(1, 2000) })

const SPECS: Record<RecordKind, Record<string, Check>> = {
  // S3 v2: an assessment or a question is about a note (`entryId`) or a Task (`taskId`), exactly one (D-74).
  assessment: { entryId: nullable(id), taskId: nullable(id), harnessVersion: int(1, 1000), runId: id, at: dateTime },
  question: {
    entryId: nullable(id), taskId: nullable(id), kind: oneOf('harness', 'removal'), text: line(1, 200), state: oneOf('open', 'answered', 'dismissed'),
    answer: nullable(text(1, 2000)), createdAt: dateTime, answeredAt: nullable(dateTime), runId: id,
  },
  link: {
    fromEntryId: id, toEntryId: id, kind: oneOf('closes', 'carries'), onDate: nullable(date),
    state: oneOf('proposed', 'confirmed', 'rejected'), evidence: line(0, 200), runId: id,
  },
  entryState: { state: oneOf('open', 'done', 'dropped'), followUpOn: nullable(date), by: oneOf('owner', 'confirmed-proposal'), updatedAt: dateTime },
  widget: {
    name: line(1, 80), kind: oneOf('system', 'prompt', 'project'), active: bool, lens: nullable(LENS), lineage: nullable(id),
    project: nullable(PROJECT), appearance: nullable(APPEARANCE),
    createdAt: dateTime, updatedAt: dateTime,
  },
  report: {
    widgetId: id, lensVersion: int(1, 1000), runId: id, entryIds: idList(200), body: text(1, 10_000),
    citations: listOf(shape({ entryId: id, quote: line(1, 200) }), 200), executor: oneOf('copy-prompt', 'model'), ranAt: dateTime,
    origin: oneOf('ai-observation'), droppedCitations: int(0, 1000),
  },
  run: {
    stage: oneOf('harness', 'widget'), version: int(1, 1000), widgetId: nullable(id), entryIds: idList(200), ranAt: dateTime, executor: oneOf('copy-prompt', 'model'),
    taskIds: idList(TASK_SOURCES_MAX), modelId: nullable(id), callId: nullable(id),
  },
  task: {
    text: line(1, 200), sourceEntryIds: idList(TASK_SOURCES_MAX), due: nullable(date), state: oneOf('open', 'done', 'dropped'), followUpOn: nullable(date),
    by: oneOf('harness', 'owner'), editedAt: nullable(dateTime), runId: nullable(id), createdAt: dateTime, updatedAt: dateTime,
  },
  taskProposal: {
    op: oneOf('close', 'revise', 'split', 'merge'), taskIds: idList(MERGE_TASKS_MAX), basis: listOf(line(1, 200), MERGE_TASKS_MAX), text: nullable(line(1, 200)),
    due: nullable(date), parts: listOf(shape({ text: line(1, 200), sourceEntryIds: idList(TASK_SOURCES_MAX) }), SPLIT_PARTS_MAX), entryId: nullable(id),
    evidence: line(0, 200), state: oneOf('proposed', 'confirmed', 'rejected'), runId: id, createdAt: dateTime,
  },
}

/** Exactly one subject, or — on an older build's row, which has no `taskId` — a note, as before. */
const subject = (f: Record<string, unknown>) =>
  !('taskId' in f) ? (f.entryId === null ? 'a row from before tasks names its note' : null)
    : (f.entryId === null) === (f.taskId === null) ? 'names a note or a task, exactly one' : null

/** The shape each proposal op has as `harness2Reply` builds it: the fields an op does not use are empty. */
function proposalRule(f: Record<string, unknown>): string | null {
  const ids = f.taskIds as string[]
  const parts = f.parts as { sourceEntryIds: string[] }[]
  if ((f.basis as string[]).length !== ids.length) return 'a proposal keeps one basis text per task'
  if (new Set(ids).size !== ids.length) return 'a proposal names each task once'
  const unused = (keys: string[]) => keys.some((k) => (k === 'parts' ? parts.length > 0 : k === 'evidence' ? f.evidence !== '' : f[k] !== null))
  switch (f.op) {
    case 'close':
      return ids.length !== 1 || f.entryId === null || f.evidence === '' || unused(['text', 'due', 'parts'])
        ? 'a close names one task, its note and the evidence, nothing else' : null
    case 'revise':
      return ids.length !== 1 || (f.text === null && f.due === null) || unused(['parts', 'entryId', 'evidence'])
        ? 'a revise names one task and a new text or date, nothing else' : null
    case 'split':
      return ids.length !== 1 || parts.length < 2 || parts.some((p) => p.sourceEntryIds.length === 0) || unused(['text', 'due', 'entryId', 'evidence'])
        ? `a split names one task and 2–${SPLIT_PARTS_MAX} parts, each with a source, nothing else` : null
    default: // merge
      return ids.length < 2 || f.text === null || unused(['due', 'parts', 'entryId', 'evidence'])
        ? `a merge names 2–${MERGE_TASKS_MAX} tasks and the merged text, nothing else` : null
  }
}

/** Cross-field rules a single-field check cannot see. Returns an error, or null. */
const RULES: Record<RecordKind, (f: Record<string, unknown>) => string | null> = {
  assessment: subject,
  question: (f) => {
    const s = subject(f)
    if (s) return s
    if (('taskId' in f) !== ('kind' in f)) return 'taskId and kind come together'
    if (f.kind === 'removal' && f.taskId === null) return 'a removal question is about a task'
    const answered = f.state === 'answered'
    if (answered !== (f.answer !== null) || answered !== (f.answeredAt !== null)) return 'an answered question has an answer and a time, any other does not'
    return null
  },
  link: (f) => ((f.kind === 'carries') !== (f.onDate !== null) ? 'a carry has a date, a close does not' : null),
  entryState: (f) => (f.followUpOn !== null && f.state !== 'open' ? 'only an open note carries a follow-up date' : null),
  widget: (f) =>
    (f.kind === 'prompt') !== (f.lens !== null) ? 'a prompt widget has a lens, the other kinds do not'
      // An older build's row has no `project` key (absent): it is never a project widget, so absence passes for the others.
      : (f.kind === 'project') !== (f.project != null) ? 'a project widget names its repo, the other kinds do not'
      : null,
  report: () => null,
  run: (f) =>
    (f.stage === 'widget') !== (f.widgetId !== null) ? 'a widget run names its widget, a harness run does not'
      // A model run names its model and call; a copy-prompt run names neither. Absent (an older build) passes: it has neither.
      : f.executor === 'model' && (typeof f.modelId !== 'string' || typeof f.callId !== 'string') ? 'a model run names its model and call'
      : f.executor === 'copy-prompt' && (f.modelId != null || f.callId != null) ? 'a copy-prompt run names no model or call'
      : null,
  task: (f) =>
    f.followUpOn !== null && f.state !== 'open' ? 'only an open task carries a follow-up date'
      : f.by === 'owner' && f.editedAt === null ? 'owner text has an edit time' : null,
  taskProposal: proposalRule,
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
  const absent: string[] = []
  const added = ADDED_FIELDS[recordKind] ?? []
  for (const [key, check] of Object.entries(SPECS[recordKind])) {
    if (!(key in o)) {
      if (added.includes(key)) absent.push(key)
      else errors.push(`${key}: missing`)
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
  return { ok: true, value: { recordKind, id: (recordId as { value: string }).value, deletedAt: (deletedAt as { value: string | null }).value, fields, absent } }
}

/**
 * The Worker's merge for `ADDED_FIELDS` (and only those): a key the push lacks takes the stored row's value, so an edit from
 * an older build — which dropped the key when it pulled the row — does not erase it. Every other field is the push's, as
 * before (replace, not merge). The result is validated again: the combination must still hold every rule.
 */
export function restoreAbsent(rec: CleanRecord, storedData: string): CleanRecordResult {
  if (rec.absent.length === 0) return { ok: true, value: rec }
  let stored: Record<string, unknown>
  try {
    stored = JSON.parse(storedData) as Record<string, unknown>
  } catch {
    return { ok: true, value: rec }
  }
  const back = rec.absent.filter((k) => k in stored)
  if (back.length === 0) return { ok: true, value: rec }
  return cleanRecord(rec.recordKind, { ...flatten(rec), ...Object.fromEntries(back.map((k) => [k, stored[k]])) })
}

/** The flat wire / device form of a validated record: `{ id, ...fields, deletedAt }`. */
export function flatten(r: CleanRecord): Record<string, unknown> {
  return { id: r.id, ...r.fields, deletedAt: r.deletedAt }
}
