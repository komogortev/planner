// The pure half of `task-add.mjs` (D-141): builds the Task an outside source asks for, and the SQL that inserts it the way
// the push route would for a new row (api/src/records.ts). No Node, Workers or D1 APIs here, so the Worker tests run it
// against a real local D1 and the script runs it under Node.
//
// The row is built by the app's own `addTask` and passed through `cleanRecord`, the validator the Worker applies to every
// push, so the stored text is exactly what a device would send: a device's later replay of it is a `duplicate`, not an edit.
// The id is derived from the source (`gmail:<threadId>`), so asking twice for the same email finds the first task.
import { cleanRecord } from '../../src/domain/records'
import { addTask, normalizeTaskText } from '../../src/domain/tasks'
import { uuid5 } from '../../src/domain/uuid5'

/** Where an outside task came from: `<system>:<its id>`, e.g. `gmail:19a5c3f0e2b7d811`. Never stored in the row, only hashed. */
export const SOURCE = /^[a-z][a-z0-9-]{1,23}:[A-Za-z0-9_.-]{1,128}$/

/** The Task id for a source. Stable forever: changing the prefix would make every source look new. */
export const taskIdFor = (source: string) => uuid5(`external-task|${source}`)

export type TaskAddInput = { source: string; text: string; due: string | null; now: string }
export type TaskAddPlan = { id: string; fields: Record<string, unknown>; data: string }

export function planTaskAdd(input: TaskAddInput): { ok: true; value: TaskAddPlan } | { ok: false; error: string } {
  if (!SOURCE.test(input.source)) return { ok: false, error: `not a source (system:id): ${input.source}` }
  const id = taskIdFor(input.source)
  const built = addTask(id, input.text, input.due, input.now)
  if (!built.ok) return built
  const cleaned = cleanRecord('task', { ...built.value, deletedAt: null })
  if (!cleaned.ok) return { ok: false, error: cleaned.errors.join('; ') }
  return { ok: true, value: { id, fields: cleaned.value.fields, data: JSON.stringify(cleaned.value.fields) } }
}

/** An open task, not deleted, whose text means the same: the owner may have typed it in by hand already. */
export function sameOpenTask(plan: TaskAddPlan, rows: { id: string; data: string }[]): string | null {
  const want = normalizeTaskText(plan.fields.text as string)
  for (const r of rows) {
    const d = JSON.parse(r.data) as { text?: unknown; state?: unknown }
    if (d.state === 'open' && typeof d.text === 'string' && normalizeTaskText(d.text) === want) return r.id
  }
  return null
}

export const sq = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * The write, as statements run in order in one execution. Both are guarded on the row being absent, so a run that finds the
 * task already there (made by an earlier run, or deleted by the owner since) bumps nothing and inserts nothing: a deleted
 * task is never brought back. The new row takes the account's next version, which is what makes every device pull it.
 */
export function insertStatements(userId: string, plan: TaskAddPlan, receivedAt: number): string[] {
  const absent = `NOT EXISTS (SELECT 1 FROM records WHERE user_id = ${sq(userId)} AND kind = 'task' AND id = ${sq(plan.id)})`
  return [
    `UPDATE users SET version_seq = version_seq + 1 WHERE id = ${sq(userId)} AND ${absent};`,
    `INSERT INTO records (user_id, kind, id, data, deleted_at, server_version, received_at) SELECT id, 'task', ${sq(plan.id)}, ${sq(plan.data)}, NULL, version_seq, ${receivedAt} FROM users WHERE id = ${sq(userId)} AND ${absent};`,
  ]
}
