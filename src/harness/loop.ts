// The daily loop on the device (HW-HARNESS §3–§4, S3): compose a prompt, check a pasted reply against what that prompt
// sent, store what survives, and the owner's taps. The pure rules live in `domain/harness.ts` and `domain/journal.ts`; this
// file only reads the device's tables, keeps the waiting run (pending.ts) and writes through `writeRecords` (one
// transaction, outbox included). It never starts a sync itself: callers call `syncSoon()`, as capture does.
import { db } from '@/db'
import { writeRecords, type RecordWrite, type WriteResult } from '@/db/records'
import {
  answerQuestion,
  applyHarness,
  composeHarness,
  confirmLink,
  dismissQuestion,
  parseHarnessOutput,
  rejectLink,
  setNoteState,
  type Applied,
  type HarnessData,
  type Link,
  type NoteStatus,
  type Question,
  type RunHeader,
} from '@/domain/harness'
import { isNoteAssessment, isNoteQuestion } from '@/domain/harness2'
import { composeJournal, JOURNAL_LENS, validateReport, type JournalHeader, type Report } from '@/domain/journal'
import { cleanRecord, type RunRecord } from '@/domain/records'
import { uuid } from '@/utils/uuid'
import { clearPending, loadPending, savePending } from './pending'

/** The device's zone: always a valid IANA name, so `localDay` cannot throw on it (HW-HARNESS §9 point 7). */
export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

// No language setting exists yet (§9 point 4): the model answers in the language the owner wrote in.
const HARNESS_LANGUAGE = 'the same language as the note they are about'
const JOURNAL_LANGUAGE = 'the language most of the notes are written in'

const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt)

/** Everything the harness and the journal read, from this device's copy of the signed-in account. */
export async function loadHarnessData(): Promise<HarnessData> {
  const [entries, assessments, questions, links, states] = await Promise.all([
    db.entries.toArray(),
    db.assessments.toArray(),
    db.questions.toArray(),
    db.links.toArray(),
    db.entryStates.toArray(),
  ])
  // v1 reads the note rows only: a row about a Task (written by harness v2) means nothing to it.
  return { entries, assessments: live(assessments).filter(isNoteAssessment), questions: live(questions).filter(isNoteQuestion), links: live(links), states: live(states) }
}

export type Composed<H> = { prompt: string; header: H } | null
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }

const asWrites = <T extends { id: string }>(recordKind: RecordWrite['recordKind'], rows: T[]): RecordWrite[] =>
  rows.map((row) => ({ recordKind, row: row as unknown as RecordWrite['row'] }))

const failed = (w: WriteResult): string => (w.ok ? '' : `Nothing was stored: ${w.errors.slice(0, 3).join('; ')}`)

// ── Stage 1: the harness ───────────────────────────────────────────────────────────────────────────────────────────

/** Compose the harness prompt and remember its header until the reply comes back. Null = nothing to assess. */
/** Thrown when the header cannot be kept: copying a prompt whose reply could never be checked would waste the trip. */
export class PendingStorageError extends Error {
  constructor() {
    super('This browser refused to store the run (private mode or full storage), so its reply could not be checked. Nothing was copied.')
  }
}

export async function startHarness(now = new Date().toISOString()): Promise<Composed<RunHeader>> {
  const out = composeHarness(await loadHarnessData(), { runId: uuid(), now, timeZone: deviceZone(), language: HARNESS_LANGUAGE })
  if (!out) clearPending('harness')
  else if (!savePending('harness', out.header)) throw new PendingStorageError()
  return out
}

export const pendingHarness = (): RunHeader | null => loadPending('harness')

/**
 * Check a pasted reply against the waiting run. With `store`, the surviving rows and the run record are written in one
 * transaction and the run stops waiting. The check is recomputed from the tables at the moment of storing, so a preview
 * that went stale (a sync landed, another device applied the same run) can never store more than a fresh check allows.
 */
export async function applyHarnessReply(text: string, opts: { store: boolean; now?: string }): Promise<Outcome<{ applied: Applied; header: RunHeader; written: number }>> {
  const header = loadPending('harness')
  if (!header) return { ok: false, error: 'No harness run is waiting for a reply. Copy a new prompt first.' }
  const parsed = parseHarnessOutput(text)
  if (!parsed.ok) return parsed
  const now = opts.now ?? new Date().toISOString()
  const applied = applyHarness(parsed.value, header, await loadHarnessData(), now, deviceZone())
  if (!opts.store) return { ok: true, value: { applied, header, written: 0 } }
  const run: RunRecord = {
    id: header.runId,
    stage: 'harness',
    version: header.harnessVersion,
    widgetId: null,
    entryIds: [...header.toAssessIds, ...header.contextIds],
    ranAt: header.composedAt,
    executor: 'copy-prompt',
  }
  const w = await writeRecords(
    db,
    [...asWrites('assessment', applied.assessments), ...asWrites('question', applied.questions), ...asWrites('link', applied.links), ...asWrites('run', [run])],
    now,
  )
  if (!w.ok) return { ok: false, error: failed(w) }
  clearPending('harness')
  return { ok: true, value: { applied, header, written: w.written } }
}

// ── Stage 2: the Daily task journal ────────────────────────────────────────────────────────────────────────────────

export async function startJournal(now = new Date().toISOString()): Promise<Composed<JournalHeader>> {
  const out = composeJournal(await loadHarnessData(), { widgetId: JOURNAL_LENS.id, runId: uuid(), now, timeZone: deviceZone(), language: JOURNAL_LANGUAGE })
  if (!out) clearPending('widget')
  else if (!savePending('widget', out.header)) throw new PendingStorageError()
  return out
}

export const pendingJournal = (): JournalHeader | null => loadPending('widget')

/** Validate a pasted report; with `store`, keep it (immutable: a second reply for the same run is refused). */
export async function applyJournalReply(text: string, opts: { store: boolean; now?: string }): Promise<Outcome<{ report: Report; written: number }>> {
  const header = loadPending('widget')
  if (!header) return { ok: false, error: 'No journal run is waiting for a reply. Copy a new prompt first.' }
  const now = opts.now ?? new Date().toISOString()
  const known = new Set((await db.reports.toArray()).map((r) => r.id))
  const r = validateReport(text, header, await db.entries.toArray(), now, known)
  if (!r.ok) return r
  // The shared record validator has limits `validateReport` does not (citation count, 64 KB): run it now, so a preview that
  // passes is one that Store can keep.
  const rec = cleanRecord('report', { ...r.value, deletedAt: null })
  if (!rec.ok) return { ok: false, error: `This report cannot be stored: ${rec.errors.slice(0, 2).join('; ')}` }
  if (!opts.store) return { ok: true, value: { report: r.value, written: 0 } }
  const run: RunRecord = {
    id: header.runId,
    stage: 'widget',
    version: header.lensVersion,
    widgetId: header.widgetId,
    entryIds: header.entryIds,
    ranAt: header.composedAt,
    executor: 'copy-prompt',
  }
  const w = await writeRecords(db, [...asWrites('report', [r.value]), ...asWrites('run', [run])], now)
  if (!w.ok) return { ok: false, error: failed(w) }
  clearPending('widget')
  return { ok: true, value: { report: r.value, written: w.written } }
}

// ── The owner's taps ───────────────────────────────────────────────────────────────────────────────────────────────

async function writeOne(writes: RecordWrite[], now: string): Promise<Outcome<number>> {
  const w = await writeRecords(db, writes, now)
  return w.ok ? { ok: true, value: w.written } : { ok: false, error: failed(w) }
}

export async function answer(q: Question, text: string, now = new Date().toISOString()): Promise<Outcome<number>> {
  const r = answerQuestion(q, text, now)
  return r.ok ? writeOne(asWrites('question', [r.value]), now) : r
}

export async function dismiss(q: Question, now = new Date().toISOString()): Promise<Outcome<number>> {
  const r = dismissQuestion(q)
  return r.ok ? writeOne(asWrites('question', [r.value]), now) : r
}

export async function confirm(link: Link, now = new Date().toISOString()): Promise<Outcome<number>> {
  const r = confirmLink(link, live(await db.entryStates.toArray()), now)
  if (!r.ok) return r
  return writeOne([...asWrites('link', [r.value.link]), ...(r.value.state ? asWrites('entryState', [r.value.state]) : [])], now)
}

export async function reject(link: Link, now = new Date().toISOString()): Promise<Outcome<number>> {
  const r = rejectLink(link)
  return r.ok ? writeOne(asWrites('link', [r.value]), now) : r
}

/** Done · drop · carry to a day (state `open` with `followUpOn`). Records are never deleted: a state row is rewritten. */
export async function markNote(entryId: string, state: NoteStatus, followUpOn: string | null = null, now = new Date().toISOString()): Promise<Outcome<number>> {
  return writeOne(asWrites('entryState', [setNoteState(entryId, state, now, followUpOn)]), now)
}
