// Harness v2, the reply side (HW-HARNESS.md §11): parse a pasted reply and validate it against the run that produced it.
// Pure and environment-free, as `harness2.ts` (the prompt side). `create` and `attach` are applied; `close`, `revise`, `split`
// and `merge` come back as proposals; nothing writes Task text over the owner's.
import { isIsoDate, isWellFormed } from './clean'
import { addDays, EVIDENCE_MAX_CHARS, FOLLOW_UP_MAX_DAYS, localDay, normalizeQuestion, oneLine, QUESTION_MAX_CHARS, QUESTIONS_MAX, sliceChars, stateOf } from './harness'
import { HARNESS_V2, type Assessment, type HarnessData2, type Question, type RunScope2 } from './harness2'
import { checkTaskText, MERGE_TASKS_MAX, normalizeTaskText, SPLIT_PARTS_MAX, TASK_SOURCES_MAX, type Task, type TaskPart, type TaskProposal } from './tasks'
import { uuid5 } from './uuid5'

/** More operations than this in one reply is not a reply to a 60-note, 60-task prompt. */
const OUTPUT_OPS_MAX = 300

// ── Parsing ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TaskOp =
  | { op: 'create'; ref: string | null; text: string; sourceEntryIds: string[]; due: string | null }
  | { op: 'attach'; taskId: string; sourceEntryIds: string[]; due: string | null }
  | { op: 'close'; taskId: string; entryId: string; evidence: string }
  | { op: 'revise'; taskId: string; text: string | null; due: string | null }
  | { op: 'split'; taskId: string; into: TaskPart[] }
  | { op: 'merge'; taskIds: string[]; text: string }
export interface QuestionOut {
  taskId: string | null
  entryId: string | null
  text: string
}
export interface HarnessOutput2 {
  tasks: TaskOp[]
  questions: QuestionOut[]
}
export type ParseResult2 = { ok: true; value: HarnessOutput2 } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown): v is string | null => v === null || v === undefined || typeof v === 'string'
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const orNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** One operation, or the reason it is not one. Absent optional fields read as null. */
function parseOp(o: unknown): TaskOp | string {
  if (!isObj(o) || !isStr(o.op)) return 'has no "op"'
  switch (o.op) {
    case 'create':
      if (!isStr(o.text) || !isStrList(o.sourceEntryIds) || !strOrNull(o.due) || !strOrNull(o.ref)) return 'create needs text, sourceEntryIds, due'
      return { op: 'create', ref: orNull(o.ref), text: o.text, sourceEntryIds: o.sourceEntryIds, due: orNull(o.due) }
    case 'attach':
      if (!isStr(o.taskId) || !isStrList(o.sourceEntryIds) || !strOrNull(o.due)) return 'attach needs taskId, sourceEntryIds'
      return { op: 'attach', taskId: o.taskId, sourceEntryIds: o.sourceEntryIds, due: orNull(o.due) }
    case 'close':
      if (!isStr(o.taskId) || !isStr(o.entryId) || !isStr(o.evidence)) return 'close needs taskId, entryId, evidence'
      return { op: 'close', taskId: o.taskId, entryId: o.entryId, evidence: o.evidence }
    case 'revise':
      if (!isStr(o.taskId) || !strOrNull(o.text) || !strOrNull(o.due)) return 'revise needs taskId'
      return { op: 'revise', taskId: o.taskId, text: orNull(o.text), due: orNull(o.due) }
    case 'split':
      if (!isStr(o.taskId) || !Array.isArray(o.into) || !o.into.every((p) => isObj(p) && isStr(p.text) && isStrList(p.sourceEntryIds)))
        return 'split needs taskId and into: [{text, sourceEntryIds}]'
      return { op: 'split', taskId: o.taskId, into: (o.into as TaskPart[]).map((p) => ({ text: p.text, sourceEntryIds: p.sourceEntryIds })) }
    case 'merge':
      if (!isStrList(o.taskIds) || !isStr(o.text)) return 'merge needs taskIds and text'
      return { op: 'merge', taskIds: o.taskIds, text: o.text }
    default:
      return `"${sliceChars(String(o.op), 20)}" is not an operation`
  }
}

/** A reply that is one JSON object, bare or in a single code fence. Anything else is refused, never guessed at. */
export function parseHarnessOutput2(text: string): ParseResult2 {
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
  if (!isObj(raw) || !Array.isArray(raw.tasks)) return { ok: false, error: 'The reply has no "tasks" list.' }
  const rawQuestions = raw.questions ?? []
  if (!Array.isArray(rawQuestions)) return { ok: false, error: '"questions" must be a list.' }
  if (raw.tasks.length + rawQuestions.length > OUTPUT_OPS_MAX) return { ok: false, error: 'The reply holds too many items.' }
  const tasks: TaskOp[] = []
  for (const [i, o] of raw.tasks.entries()) {
    const r = parseOp(o)
    if (typeof r === 'string') return { ok: false, error: `Task operation ${i + 1}: ${r}.` }
    tasks.push(r)
  }
  const questions: QuestionOut[] = []
  for (const [i, q] of rawQuestions.entries()) {
    if (!isObj(q) || !isStr(q.text) || !strOrNull(q.taskId) || !strOrNull(q.entryId)) return { ok: false, error: `Question ${i + 1} must be {taskId, entryId, text}.` }
    questions.push({ taskId: orNull(q.taskId), entryId: orNull(q.entryId), text: q.text })
  }
  return { ok: true, value: { tasks, questions } }
}

// ── Near-repeat questions (A1, umbrella docs/architecture/06 §3 L7) ─────────────────────────────────────────────────
// The prompt says "never repeat a question"; a reworded repeat slips past the exact match, and D-70 threads make rewordings
// likely. Content words: runs of 4+ letters or digits, minus common English question words. Two questions repeat when their
// shared content words — other than the Task's own — are at least half of the shorter question's. Under 3 content words only the exact match applies:
// too few words to tell a rewording from a different question. It drops model output only, never owner text.
const NEAR_MIN_WORDS = 3
const NEAR_OVERLAP = 0.5
const FUNCTION_WORDS = new Set(
  'what which when where whom whose would should could will shall must might your yours this that these those with from have does there their them they then than about into just still also very'.split(' '),
)

export function contentWords(text: string): Set<string> {
  return new Set((normalizeQuestion(text).match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !FUNCTION_WORDS.has(w)))
}

const without = (a: Set<string>, b: Set<string>): Set<string> => new Set([...a].filter((w) => !b.has(w)))

export function nearRepeat(a: Set<string>, b: Set<string>): boolean {
  if (a.size < NEAR_MIN_WORDS || b.size < NEAR_MIN_WORDS) return false
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared >= NEAR_OVERLAP * Math.min(a.size, b.size)
}

// ── Validation + apply ─────────────────────────────────────────────────────────────────────────────────────────────

export type DropReason2 =
  | 'already-applied' // this run's reply was stored before: a replay
  | 'unknown-task' // not an open task of this prompt (or a ref no create defined)
  | 'task-not-open' // done, dropped or deleted since the prompt was composed
  | 'stale-run' // another run assessed the task or note after this prompt was composed
  | 'unknown-source' // a note id that is not in this prompt, or no longer open
  | 'no-source' // a create that cites no to-assess note
  | 'deduped' // a create that repeats an open task: turned into an attach (informational)
  | 'nothing-new' // an attach or revise that changes nothing
  | 'due-set' // an attach that would change a task's existing date (that is a revise)
  | 'bad-text' // empty, too long or ill-formed
  | 'bad-date'
  | 'date-in-past'
  | 'date-too-far'
  | 'no-evidence'
  | 'bad-parts' // a split into fewer than 2 or more than SPLIT_PARTS_MAX parts, or a part with no source
  | 'bad-merge' // fewer than 2 or more than MERGE_TASKS_MAX distinct tasks
  | 'repeated-proposal'
  | 'bad-subject' // a question that names both a task and a note, or neither
  | 'not-assessable' // a question on a note that is not to-assess in this run
  | 'repeated-question'
  | 'too-many-questions'
export interface Drop2 {
  reason: DropReason2
  ref: string // the task, note, ref or op the drop concerns
}

export interface Applied2 {
  assessments: Assessment[]
  tasks: Task[] // created rows and rows whose sources grew
  proposals: TaskProposal[]
  questions: Question[]
  dropped: Drop2[]
}

/**
 * Validate a parsed reply against what the run actually sent, and return only the rows worth storing. Whatever the model
 * got wrong is dropped and counted, never repaired. A replay (this run already stored) returns no rows. Every to-assess
 * note and re-evaluated task that is still open gets its assessment: the model saw it, whether or not it had anything to say.
 */
export function applyHarness2(output: HarnessOutput2, run: RunScope2, data: HarnessData2, now: string, timeZone: string): Applied2 {
  const res: Applied2 = { assessments: [], tasks: [], proposals: [], questions: [], dropped: [] }
  const drop = (reason: DropReason2, ref: string) => res.dropped.push({ reason, ref })
  if (data.assessments.some((a) => a.runId === run.runId)) {
    drop('already-applied', run.runId)
    return res
  }
  // "Today" is the day the model was told, and the assessment time is the compose time: an answer given between compose and
  // paste must still count as newer than the assessment.
  const today = localDay(run.composedAt, timeZone)
  const horizon = addDays(today, FOLLOW_UP_MAX_DAYS)
  const staleAfter = (rows: Assessment[]) => rows.some((a) => a.runId !== run.runId && a.at >= run.composedAt)

  // Notes this reply may cite: in the prompt, still live and open. Fresh = to-assess and not assessed by another run since.
  const entryById = new Map(data.entries.map((e) => [e.id, e]))
  const openNote = (id: string) => entryById.has(id) && !entryById.get(id)!.deletedAt && stateOf(data.states, id) === 'open'
  const citable = new Set([...run.toAssessIds, ...run.contextIds].filter(openNote))
  const fresh = new Set(run.toAssessIds.filter((id) => citable.has(id) && !staleAfter(data.assessments.filter((a) => a.entryId === id))))

  // Tasks: `working` holds every task as this reply leaves it, so a create can dedupe against one made a line earlier.
  const working = new Map(data.tasks.map((t) => [t.id, t]))
  const inPrompt = new Set(run.taskIds)
  const touched = new Set<string>()
  const created = new Set<string>()
  const refs = new Map<string, string>()
  const usableTask = (id: string): Task | null => {
    const t = working.get(id)
    if (!t || (!inPrompt.has(id) && !created.has(id))) return drop('unknown-task', id), null
    if (t.state !== 'open') return drop('task-not-open', id), null
    if (!created.has(id) && staleAfter(data.assessments.filter((a) => a.taskId === id))) return drop('stale-run', id), null
    return t
  }
  /** Prompt tasks only: proposals and attaches never target a task created in the same reply. */
  const promptTask = (id: string): Task | null => (created.has(id) ? (drop('unknown-task', id), null) : usableTask(id))
  const sources = (ids: string[]): string[] => {
    const out: string[] = []
    for (const id of new Set(ids)) {
      if (citable.has(id)) out.push(id)
      else drop('unknown-source', id)
    }
    return out
  }
  const text = (raw: string, ref: string): string | null => {
    const t = checkTaskText(raw)
    return t.ok ? t.value : (drop('bad-text', ref), null)
  }
  const due = (d: string | null, ref: string): string | null | undefined => {
    if (d === null) return null
    if (!isIsoDate(d)) return drop('bad-date', ref), undefined
    if (d < today) return drop('date-in-past', ref), undefined
    if (d > horizon) return drop('date-too-far', ref), undefined
    return d
  }
  const knownProposal = new Set(data.proposals.map((p) => p.id))
  const propose = (p: Omit<TaskProposal, 'state' | 'runId' | 'createdAt'>, ref: string) => {
    if (knownProposal.has(p.id)) return drop('repeated-proposal', ref)
    knownProposal.add(p.id)
    res.proposals.push({ ...p, state: 'proposed', runId: run.runId, createdAt: now })
  }
  const grow = (t: Task, add: string[], d: string | null): boolean => {
    const ids = [...new Set([...t.sourceEntryIds, ...add])].slice(0, TASK_SOURCES_MAX)
    const nextDue = t.due ?? d
    if (ids.length === t.sourceEntryIds.length && nextDue === t.due) return false
    working.set(t.id, { ...t, sourceEntryIds: ids, due: nextDue, updatedAt: now })
    touched.add(t.id)
    return true
  }
  const openByText = (norm: string) => [...working.values()].find((t) => t.state === 'open' && normalizeTaskText(t.text) === norm)

  for (const op of output.tasks) {
    switch (op.op) {
      case 'create': {
        const ref = op.ref ?? op.text
        const t = text(op.text, ref)
        if (t === null) break
        const src = sources(op.sourceEntryIds)
        if (!src.some((id) => fresh.has(id))) {
          drop('no-source', ref)
          break
        }
        const d = due(op.due, ref) ?? null
        const norm = normalizeTaskText(t)
        const same = openByText(norm)
        if (same) {
          // Dedupe: the topic is already open. The owner's text stays; the note joins it.
          drop('deduped', same.id)
          grow(same, src, d)
          if (op.ref !== null && !refs.has(op.ref)) refs.set(op.ref, same.id)
          break
        }
        const id = uuid5(`${run.runId}|${norm}`)
        const row: Task = { id, text: t, sourceEntryIds: src.slice(0, TASK_SOURCES_MAX), due: d, state: 'open', followUpOn: null, by: 'harness', editedAt: null, runId: run.runId, createdAt: now, updatedAt: now }
        working.set(id, row)
        created.add(id)
        touched.add(id)
        if (op.ref !== null && !refs.has(op.ref)) refs.set(op.ref, id)
        break
      }
      case 'attach': {
        const t = promptTask(op.taskId)
        if (!t) break
        const src = sources(op.sourceEntryIds)
        if (op.due !== null && t.due !== null && op.due !== t.due) drop('due-set', t.id)
        const d = t.due === null ? (due(op.due, t.id) ?? null) : null
        if (!grow(t, src, d)) drop('nothing-new', t.id)
        break
      }
      case 'close': {
        const t = promptTask(op.taskId)
        if (!t) break
        if (!citable.has(op.entryId)) {
          drop('unknown-source', op.entryId)
          break
        }
        const evidence = isWellFormed(op.evidence) ? sliceChars(oneLine(op.evidence), EVIDENCE_MAX_CHARS) : ''
        if (evidence === '') {
          drop('no-evidence', t.id)
          break
        }
        propose({ id: uuid5(`close|${t.id}|${op.entryId}`), op: 'close', taskIds: [t.id], basis: [t.text], text: null, due: null, parts: [], entryId: op.entryId, evidence }, t.id)
        break
      }
      case 'revise': {
        const t = promptTask(op.taskId)
        if (!t) break
        const newText = op.text === null ? null : text(op.text, t.id)
        if (op.text !== null && newText === null) break
        const d = due(op.due, t.id)
        if (d === undefined) break
        const textChanges = newText !== null && newText !== t.text
        const dueChanges = d !== null && d !== t.due
        if (!textChanges && !dueChanges) {
          drop('nothing-new', t.id)
          break
        }
        const pText = textChanges ? newText : null
        const pDue = dueChanges ? d : null
        propose({ id: uuid5(`revise|${t.id}|${pText ?? ''}|${pDue ?? ''}`), op: 'revise', taskIds: [t.id], basis: [t.text], text: pText, due: pDue, parts: [], entryId: null, evidence: '' }, t.id)
        break
      }
      case 'split': {
        const t = promptTask(op.taskId)
        if (!t) break
        if (op.into.length < 2 || op.into.length > SPLIT_PARTS_MAX) {
          drop('bad-parts', t.id)
          break
        }
        const allowed = new Set([...t.sourceEntryIds, ...citable])
        const parts: TaskPart[] = []
        for (const p of op.into) {
          const pt = text(p.text, t.id)
          const src = [...new Set(p.sourceEntryIds)].filter((id) => allowed.has(id)).slice(0, TASK_SOURCES_MAX) // as create and attach
          if (pt === null || src.length === 0) break
          parts.push({ text: pt, sourceEntryIds: src })
        }
        if (parts.length !== op.into.length || new Set(parts.map((p) => normalizeTaskText(p.text))).size !== parts.length) {
          drop('bad-parts', t.id)
          break
        }
        const key = parts.map((p) => normalizeTaskText(p.text)).join('|')
        propose({ id: uuid5(`split|${t.id}|${key}`), op: 'split', taskIds: [t.id], basis: [t.text], text: null, due: null, parts, entryId: null, evidence: '' }, t.id)
        break
      }
      case 'merge': {
        const ids = [...new Set(op.taskIds)]
        if (ids.length < 2 || ids.length > MERGE_TASKS_MAX) {
          drop('bad-merge', ids.join(','))
          break
        }
        const targets = ids.map(promptTask)
        if (targets.some((t) => t === null)) break
        const mt = text(op.text, ids.join(','))
        if (mt === null) break
        const ts = targets as Task[]
        propose({ id: uuid5(`merge|${[...ids].sort().join(',')}|${normalizeTaskText(mt)}`), op: 'merge', taskIds: ids, basis: ts.map((t) => t.text), text: mt, due: null, parts: [], entryId: null, evidence: '' }, ids.join(','))
        break
      }
    }
  }

  // Questions, after the operations so a question can name the ref of a task created above.
  const asked = new Map<string, number>()
  const seen = new Map<string, { exact: Set<string>; words: Set<string>[]; topic: Set<string> }>()
  const askedOn = (subject: string) => {
    if (!seen.has(subject)) {
      // A thread's follow-ups name their Task ("the bulbs"): the Task's own words say nothing about a repeat.
      const topic = contentWords(working.get(subject)?.text ?? '')
      const texts = data.questions.filter((q) => (q.taskId ?? q.entryId) === subject).map((q) => q.text)
      seen.set(subject, { exact: new Set(texts.map(normalizeQuestion)), words: texts.map((t) => without(contentWords(t), topic)), topic })
    }
    return seen.get(subject)!
  }
  for (const q of output.questions) {
    if ((q.taskId === null) === (q.entryId === null)) {
      drop('bad-subject', q.taskId ?? q.entryId ?? '')
      continue
    }
    let subject: string
    if (q.taskId !== null) {
      const id = refs.get(q.taskId) ?? q.taskId
      if (!usableTask(id)) continue
      subject = id
    } else {
      if (!fresh.has(q.entryId!)) {
        drop('not-assessable', q.entryId!)
        continue
      }
      subject = q.entryId!
    }
    const norm = normalizeQuestion(q.text)
    const line = oneLine(q.text)
    const prior = askedOn(subject)
    const words = without(contentWords(q.text), prior.topic)
    if (!isWellFormed(q.text) || norm === '' || Array.from(line).length > QUESTION_MAX_CHARS) drop('bad-text', subject)
    else if (prior.exact.has(norm) || prior.words.some((w) => nearRepeat(words, w))) drop('repeated-question', subject)
    else if ((asked.get(subject) ?? 0) >= QUESTIONS_MAX) drop('too-many-questions', subject)
    else {
      prior.exact.add(norm)
      prior.words.push(words)
      asked.set(subject, (asked.get(subject) ?? 0) + 1)
      const onTask = q.taskId !== null
      res.questions.push({
        id: uuid5(`${subject}|${norm}`),
        entryId: onTask ? null : subject,
        taskId: onTask ? subject : null,
        kind: 'harness',
        text: line,
        state: 'open',
        answer: null,
        createdAt: now,
        answeredAt: null,
        runId: run.runId,
      })
    }
  }

  res.tasks = [...touched].map((id) => working.get(id)!)
  const assess = (subject: string, onTask: boolean): Assessment => ({
    id: uuid5(`${subject}|${run.runId}`),
    entryId: onTask ? null : subject,
    taskId: onTask ? subject : null,
    harnessVersion: HARNESS_V2,
    runId: run.runId,
    at: run.composedAt,
  })
  const reevaluated = run.reevaluateIds.filter((id) => {
    const t = data.tasks.find((x) => x.id === id)
    return t !== undefined && t.state === 'open' && !staleAfter(data.assessments.filter((a) => a.taskId === id))
  })
  res.assessments = [...[...fresh].map((id) => assess(id, false)), ...reevaluated.map((id) => assess(id, true)), ...[...created].map((id) => assess(id, true))]
  return res
}
