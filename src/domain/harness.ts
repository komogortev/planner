// The harness's shared records and helpers (HW-HARNESS.md §3, D-61): the note-level rows (assessments, questions, links,
// per-note state), days, text, and the owner's transitions. Pure and environment-free: no Dexie, Vue, DOM or Workers APIs,
// no clock reads. Harness v1's selection, prompt and reply lived here until D-113 (R4); the run is `harness2*.ts`. Link rows
// from v1 runs stay readable (sync, export) and nothing writes new ones.
import { cleanBody } from './clean'

export const QUESTIONS_MAX = 3
export const QUESTION_MAX_CHARS = 200
export const EVIDENCE_MAX_CHARS = 200
export const ANSWER_MAX_CHARS = 2_000
export const CONTEXT_DAYS = 7
export const FOLLOW_UP_MAX_DAYS = 366

// ── Records (the sync fields `serverVersion` / `deletedAt` arrive with the schema slice) ───────────────────────────

export type QuestionState = 'open' | 'answered' | 'dismissed'
export interface Question {
  id: string // uuid5(entryId|normalized text): one row per distinct question on a note
  entryId: string
  text: string
  state: QuestionState
  answer: string | null // the owner's own text; never stored on the Entry
  createdAt: string
  answeredAt: string | null
  runId: string
}

export interface Assessment {
  id: string // uuid5(entryId|runId)
  entryId: string
  harnessVersion: number
  runId: string
  at: string
}

export type LinkKind = 'closes' | 'carries'
export type LinkState = 'proposed' | 'confirmed' | 'rejected'
export interface Link {
  id: string // uuid5(from|to|kind): a pair is proposed once, whatever its state later
  fromEntryId: string // the note that gave the evidence (for `carries` it may equal `toEntryId`)
  toEntryId: string // closes: the older note that is concluded · carries: the note to carry
  kind: LinkKind
  onDate: string | null // carries only: YYYY-MM-DD
  state: LinkState
  evidence: string
  runId: string
}

export type NoteStatus = 'open' | 'done' | 'dropped'
export interface EntryState {
  id: string // = entryId; a note with no row is open
  state: NoteStatus
  followUpOn: string | null
  by: 'owner' | 'confirmed-proposal'
  updatedAt: string
}


// ── Dates ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The calendar day (YYYY-MM-DD) an instant falls on in `timeZone`. */
export function localDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

export function stateOf(states: EntryState[], entryId: string): NoteStatus {
  return states.find((s) => s.id === entryId)?.state ?? 'open'
}

// ── Text rules ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One line, controls stripped, whitespace collapsed. */
export function oneLine(s: string): string {
  return cleanBody(s).replace(/\s+/g, ' ').trim()
}

/** First `n` code points: never cuts a surrogate pair in half. */
export function sliceChars(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('')
}

/** Question identity: case, spacing and trailing punctuation do not make a different question. */
export function normalizeQuestion(text: string): string {
  return oneLine(text).toLowerCase().replace(/[\s?!.¿¡]+$/u, '')
}

// ── The owner's side: every transition is a pure function returning the rows to write ──────────────────────────────

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** Generic over the row shape, so the v2 rows (`harness2.ts`, with `taskId` and `kind`) keep their fields. */
export function answerQuestion<Q extends Pick<Question, 'state' | 'answer' | 'answeredAt'>>(q: Q, answer: string, now: string): Result<Q> {
  if (q.state !== 'open') return { ok: false, error: 'This question is already closed.' }
  const text = cleanBody(answer).trim()
  if (text === '') return { ok: false, error: 'The answer is empty.' }
  if (text.length > ANSWER_MAX_CHARS) return { ok: false, error: `The answer is longer than ${ANSWER_MAX_CHARS} characters.` }
  return { ok: true, value: { ...q, state: 'answered', answer: text, answeredAt: now } }
}

export function dismissQuestion<Q extends Pick<Question, 'state'>>(q: Q): Result<Q> {
  return q.state === 'open' ? { ok: true, value: { ...q, state: 'dismissed' } } : { ok: false, error: 'This question is already closed.' }
}

/** The owner marks a note done or dropped. `by: 'owner'` is never overwritten by a later confirmation. */
export function setNoteState(entryId: string, state: NoteStatus, now: string, followUpOn: string | null = null): EntryState {
  return { id: entryId, state, followUpOn: state === 'open' ? followUpOn : null, by: 'owner', updatedAt: now }
}

