// The report a widget run stores, and its check (HW-HARNESS.md §4, D-61). The v1 "daily task journal" prompt lived here
// until D-113 (R4); the Summary v3 lens (`summaryLens.ts`) composes its own prompt and uses this check and record shape.
// Pure and environment-free: `now` is an argument, the report id is derived.
import { cleanBody, isWellFormed } from './clean'
import type { Entry } from './entry'
import { oneLine, sliceChars } from './harness'
import { uuid5 } from './uuid5'
import type { Executor } from './records'

export const REPORT_BODY_MAX_CHARS = 10_000
export const QUOTE_MAX_CHARS = 200
/** A citation shorter than this proves nothing ('a' occurs in every note); a shorter note is cited whole. */
export const QUOTE_MIN_CHARS = 8

export interface JournalHeader {
  runId: string
  stage: 'widget'
  widgetId: string
  lensVersion: number
  composedAt: string
  entryIds: string[]
  truncated: number
}

const fence = (s: string) => s.replace(/<(\/?note)/gi, '< $1')

// ── Report ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Citation {
  entryId: string
  quote: string
}
export interface Report {
  id: string // uuid5(widgetId|runId): the same result stored twice is the same report
  widgetId: string
  lensVersion: number
  runId: string
  entryIds: string[] // the slice as it was sent
  body: string
  citations: Citation[]
  executor: Executor
  ranAt: string
  origin: 'ai-observation'
  droppedCitations: number // > 0 flags the report: the model cited something the slice does not support
}
export type ReportResult = { ok: true; value: Report } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const squash = (s: string) => oneLine(s).toLowerCase()

/**
 * Parse and validate a model's reply against the slice the run sent. A citation survives only if its note is in the
 * slice AND its quote really occurs in that note (whitespace and case aside): the model cannot cite what the owner
 * did not write. Dropped citations are counted and flag the report; they are never repaired.
 */
export function validateReport(
  text: string,
  run: JournalHeader,
  entries: Entry[],
  now: string,
  knownReportIds: ReadonlySet<string> = new Set(),
  shown: (body: string) => string = fence, // how the prompt showed a note's text, so a quote of what the model saw matches
): ReportResult {
  const id = uuid5(`${run.widgetId}|${run.runId}`)
  // Reports are immutable: a second reply for a run that already has one is refused, never stored over it.
  if (knownReportIds.has(id)) return { ok: false, error: 'This run already has a stored report.' }
  let body = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body)
  if (fenced) body = fenced[1].trim()
  if (!body.startsWith('{')) return { ok: false, error: 'The reply is not a single JSON object.' }
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return { ok: false, error: 'The reply is not valid JSON.' }
  }
  if (!isObj(raw) || typeof raw.body !== 'string') return { ok: false, error: 'The reply has no "body".' }
  const reportBody = cleanBody(raw.body).trim()
  if (reportBody === '') return { ok: false, error: 'The report is empty.' }
  if (!isWellFormed(raw.body)) return { ok: false, error: 'The report holds a broken character.' }
  if (reportBody.length > REPORT_BODY_MAX_CHARS) return { ok: false, error: `The report is longer than ${REPORT_BODY_MAX_CHARS} characters.` }
  const rawCitations = raw.citations ?? []
  if (!Array.isArray(rawCitations) || !rawCitations.every((c) => isObj(c) && typeof c.entryId === 'string' && typeof c.quote === 'string'))
    return { ok: false, error: '"citations" must be a list of {entryId, quote}.' }

  const inSlice = new Set(run.entryIds)
  // A note is matched as written AND as shown in the prompt (`<note` is spaced there), so quoting what the model saw works.
  const bodyOf = new Map(entries.map((e) => [e.id, [squash(e.body), squash(shown(e.body))]]))
  const kept: Citation[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const c of rawCitations as Array<{ entryId: string; quote: string }>) {
    const quote = sliceChars(oneLine(c.quote), QUOTE_MAX_CHARS)
    const key = `${c.entryId}|${quote}`
    const note = bodyOf.get(c.entryId)
    const q = quote.toLowerCase()
    const minimum = note === undefined ? QUOTE_MIN_CHARS : Math.min(QUOTE_MIN_CHARS, Array.from(note[0]).length)
    if (!isWellFormed(c.quote) || !inSlice.has(c.entryId) || note === undefined || Array.from(q).length < minimum || !note.some((n) => n.includes(q))) dropped++
    else if (!seen.has(key)) {
      seen.add(key)
      kept.push({ entryId: c.entryId, quote })
    }
  }
  return {
    ok: true,
    value: {
      id,
      widgetId: run.widgetId,
      lensVersion: run.lensVersion,
      runId: run.runId,
      entryIds: run.entryIds,
      body: reportBody,
      citations: kept,
      executor: 'model',
      ranAt: now,
      origin: 'ai-observation',
      droppedCitations: dropped,
    },
  }
}
