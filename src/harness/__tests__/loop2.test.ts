import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { recordTables } from '@/db/records'
import type { Entry } from '@/domain/entry'
import { REMOVAL_QUESTION } from '@/domain/summary'
import { startHarness } from '../loop'
import {
  addTask2,
  answer2,
  answerRemoval2,
  applyHarnessReply2,
  confirmProposal2,
  correctProposal2,
  harnessWork,
  rejectProposal2,
  setTaskState2,
  loadHarnessData2,
  pendingHarness2,
  saveSummary,
  startHarness2,
  today,
} from '../loop2'
import { loadPending } from '../pending'

// The suite runs in node: a minimal localStorage (the pending run lives there, like the capture draft).
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
})

// Synthetic fixtures only (public repo). Midday UTC, so "today" is the same calendar day in any zone from −11 to +11.
const NOW = '2026-10-11T12:30:00.000Z'
const LATER = '2026-10-11T12:40:00.000Z'
const LATEST = '2026-10-11T12:50:00.000Z'
const note = (id: string, createdAt: string, body = `body of ${id}`): Entry => ({
  id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, serverVersion: 1,
})
const N1 = 'a0000000-0000-4000-8000-000000000001'
const N2 = 'a0000000-0000-4000-8000-000000000002'
const reply = (o: unknown) => JSON.stringify(o)
const firstReply = reply({
  tasks: [{ op: 'create', ref: 't', text: 'Replace the hall bulb', sourceEntryIds: [N1, N2], due: null }],
  questions: [{ taskId: 't', entryId: null, text: 'Which bulb type does the hall lamp take?' }],
})
const counts = async () => ({
  tasks: await db.tasks.count(),
  taskProposals: await db.taskProposals.count(),
  assessments: await db.assessments.count(),
  questions: await db.questions.count(),
  runs: await db.runs.count(),
})

beforeEach(async () => {
  localStorage.clear()
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), ...recordTables(db).map((t) => t.clear())])
  await db.entries.bulkPut([note(N1, '2026-10-11T11:00:00.000Z', 'hall light is out'), note(N2, '2026-10-11T12:00:00.000Z', 'need a bulb')])
})

describe('harness v2 on the device', () => {
  it('a stored reply writes the Task, its question, the assessments and a run carrying task ids, all through the outbox', async () => {
    const c = (await startHarness2(NOW))!
    expect(c.header).toMatchObject({ harnessVersion: 2, toAssessIds: [N1, N2], taskIds: [] })
    expect(pendingHarness2()).toEqual(c.header)
    const r = await applyHarnessReply2(firstReply, { store: true, now: LATER })
    expect(r.ok).toBe(true)
    expect(await counts()).toEqual({ tasks: 1, taskProposals: 0, assessments: 3, questions: 1, runs: 1 })
    const [task] = await db.tasks.toArray()
    expect(task).toMatchObject({ text: 'Replace the hall bulb', by: 'harness', sourceEntryIds: [N1, N2] })
    expect((await db.questions.toArray())[0]).toMatchObject({ taskId: task.id, entryId: null, kind: 'harness' })
    expect((await db.runs.toArray())[0]).toMatchObject({ version: 2, taskIds: [] })
    expect(await db.outbox.count()).toBe(6)
    expect(pendingHarness2()).toBeNull()
  })

  it('H5: a reply from a registered model stores a model run naming its model and call; a paste names neither', async () => {
    await startHarness2(NOW)
    expect((await applyHarnessReply2(firstReply, { store: true, now: LATER, via: { modelId: 'm1', callId: 'c-1' } })).ok).toBe(true)
    const [run] = await db.runs.toArray()
    expect(run).toMatchObject({ executor: 'model', modelId: 'm1', callId: 'c-1' })
    const queued = (await db.outbox.toArray()).find((o) => o.recordKind === 'run')
    expect(queued?.payload).toMatchObject({ executor: 'model', modelId: 'm1', callId: 'c-1' }) // what the Worker will validate
    await Promise.all([db.outbox.clear(), ...recordTables(db).map((t) => t.clear())])
    await startHarness2(NOW)
    await applyHarnessReply2(firstReply, { store: true, now: LATER })
    const [paste] = await db.runs.toArray()
    expect(paste.executor).toBe('copy-prompt')
    expect(paste).not.toHaveProperty('modelId') // left out, as an older build would: the shared rule accepts both
  })

  it('negative control: Check without Store writes nothing and the run keeps waiting', async () => {
    await startHarness2(NOW)
    const r = await applyHarnessReply2(firstReply, { store: false, now: LATER })
    expect(r).toMatchObject({ ok: true, value: { written: 0 } })
    expect(await counts()).toEqual({ tasks: 0, taskProposals: 0, assessments: 0, questions: 0, runs: 0 })
    expect(pendingHarness2()).not.toBeNull()
  })

  it('a v1 prompt waiting at the switch is refused with its reason, and v1 never reads a v2 header', async () => {
    await startHarness(NOW)
    expect(pendingHarness2()).toBeNull()
    const r = await applyHarnessReply2(firstReply, { store: true, now: LATER })
    expect(r).toEqual({ ok: false, error: expect.stringContaining('previous version') })
    expect(await startHarness2(NOW)).not.toBeNull() // a v2 header now waits in the shared slot…
    expect(loadPending('harness')).toBeNull() // …and v1 does not take it
  })

  it('nothing waiting at all: the plain message (known positive for the version check above)', async () => {
    const r = await applyHarnessReply2(firstReply, { store: true, now: LATER })
    expect(r).toEqual({ ok: false, error: expect.stringContaining('No run is waiting') })
  })

  it('an answered question puts its Task back into the next run', async () => {
    await startHarness2(NOW)
    await applyHarnessReply2(firstReply, { store: true, now: LATER })
    expect(await startHarness2(LATER)).toBeNull() // nothing new: no prompt
    const q = (await loadHarnessData2()).questions[0]
    expect(await answer2(q, 'E27, warm white', LATEST)).toEqual({ ok: true, value: 1 })
    const c = (await startHarness2(LATEST))!
    expect(c.header.reevaluateIds).toEqual([q.taskId])
  })
})

describe('Daily and the summary', () => {
  it('a removed line carries its Task to tomorrow and asks once; "Drop it" drops it', async () => {
    expect(await addTask2('Water the plants', null, NOW)).toMatchObject({ ok: true })
    expect(await addTask2('Call the dentist', null, NOW)).toMatchObject({ ok: true })
    const shown = today(await loadHarnessData2(), NOW).tasks
    expect(shown.map((t) => t.text)).toEqual(expect.arrayContaining(['Water the plants', 'Call the dentist']))
    const kept = shown.find((t) => t.text === 'Water the plants')!
    expect(await saveSummary(shown, kept.text, LATER)).toMatchObject({ ok: true, value: 2 })
    const after = await loadHarnessData2()
    expect(today(after, LATER).tasks.map((t) => t.text)).toEqual(['Water the plants'])
    const removed = after.tasks.find((t) => t.text === 'Call the dentist')!
    expect(removed).toMatchObject({ state: 'open', followUpOn: '2026-10-12' })
    const [q] = after.questions
    expect(q).toMatchObject({ kind: 'removal', taskId: removed.id, text: REMOVAL_QUESTION, state: 'open' })
    // Saving the same edit again asks nothing new (the question is still open).
    expect(await saveSummary(today(after, LATER).tasks, kept.text, LATEST)).toEqual({ ok: true, value: 0 })
    expect(await answerRemoval2(q, 'drop', LATEST)).toEqual({ ok: true, value: 2 })
    expect((await db.tasks.get(removed.id))?.state).toBe('dropped')
  })
})

describe('proposals', () => {
  it('confirming a close marks the Task done; a second confirm is refused', async () => {
    await startHarness2(NOW)
    await applyHarnessReply2(firstReply, { store: true, now: LATER })
    const [task] = await db.tasks.toArray()
    await db.entries.put(note('a0000000-0000-4000-8000-000000000003', LATER, 'bulb replaced'))
    await startHarness2(LATEST)
    const r = await applyHarnessReply2(
      reply({ tasks: [{ op: 'close', taskId: task.id, entryId: 'a0000000-0000-4000-8000-000000000003', evidence: 'bulb replaced' }], questions: [] }),
      { store: true, now: LATEST },
    )
    expect(r.ok).toBe(true)
    const [p] = await db.taskProposals.toArray()
    expect((await db.runs.toArray()).find((x) => x.taskIds?.length)?.taskIds).toEqual([task.id])
    expect(p).toMatchObject({ op: 'close', state: 'proposed' })
    expect((await db.tasks.get(task.id))?.state).toBe('open') // a proposal changes nothing until confirmed
    expect(await confirmProposal2(p, LATEST)).toEqual({ ok: true, value: 2 })
    expect((await db.tasks.get(task.id))?.state).toBe('done')
    const live = (await db.taskProposals.get(p.id))!
    expect(await confirmProposal2(live, LATEST)).toMatchObject({ ok: false, error: expect.stringContaining('already answered') })
    expect(await confirmProposal2(p, LATEST)).toMatchObject({ ok: false }) // the screen's stale copy still says "proposed"
  })
})

describe('correcting a proposal (strip "Correct…", owner 2026-10-13)', () => {
  async function closeProposed() {
    await startHarness2(NOW)
    await applyHarnessReply2(firstReply, { store: true, now: LATER })
    const [task] = await db.tasks.toArray()
    await db.entries.put(note('a0000000-0000-4000-8000-000000000003', LATER, 'bulb replaced'))
    await startHarness2(LATEST)
    await applyHarnessReply2(
      reply({ tasks: [{ op: 'close', taskId: task.id, entryId: 'a0000000-0000-4000-8000-000000000003', evidence: 'bulb replaced' }], questions: [] }),
      { store: true, now: LATEST },
    )
    const [p] = await db.taskProposals.toArray()
    return { task, p }
  }
  const AFTER = '2026-10-11T13:00:00.000Z'

  it('sets the proposal aside, keeps the Task open, and the next prompt carries the correction under that Task', async () => {
    const { task, p } = await closeProposed()
    expect(await startHarness2(AFTER)).toBeNull() // known positive: nothing waits before the correction
    expect(await correctProposal2(p, 'Done? A note says: “bulb replaced”', 'that was the porch bulb, not the hall one', AFTER)).toEqual({ ok: true, value: 2 })
    expect((await db.taskProposals.get(p.id))?.state).toBe('rejected')
    expect((await db.tasks.get(task.id))?.state).toBe('open')
    const q = (await db.questions.toArray()).find((x) => x.text.startsWith('Proposed:'))!
    expect(q).toMatchObject({ taskId: task.id, entryId: null, state: 'answered', answer: 'that was the porch bulb, not the hall one', runId: p.runId })
    const out = await startHarness2('2026-10-11T13:10:00.000Z')
    expect(out?.header.reevaluateIds).toEqual([task.id])
    expect(out?.prompt).toContain('that was the porch bulb, not the hall one')
  })

  it('negative controls: an empty correction stores nothing; an answered proposal cannot be corrected', async () => {
    const { p } = await closeProposed()
    const before = await counts()
    expect(await correctProposal2(p, 'label', '   ', AFTER)).toMatchObject({ ok: false, error: expect.stringContaining('empty') })
    expect(await counts()).toEqual(before)
    expect((await db.taskProposals.get(p.id))?.state).toBe('proposed')
    await rejectProposal2(p, AFTER)
    expect(await correctProposal2(p, 'label', 'too late', AFTER)).toMatchObject({ ok: false, error: expect.stringContaining('already answered') })
    expect(await counts()).toEqual(before)
  })
})

describe("owner actions act on the stored row, not the screen's copy (CodeReview)", () => {
  it('a rejected proposal cannot be confirmed from a stale copy', async () => {
    await startHarness2(NOW)
    await applyHarnessReply2(firstReply, { store: true, now: LATER })
    const [task] = await db.tasks.toArray()
    await db.entries.put(note('a0000000-0000-4000-8000-000000000003', LATER, 'two different lamps'))
    await startHarness2(LATEST)
    await applyHarnessReply2(
      reply({ tasks: [{ op: 'split', taskId: task.id, into: [{ text: 'Hall bulb', sourceEntryIds: [N1] }, { text: 'Porch bulb', sourceEntryIds: [N2] }] }], questions: [] }),
      { store: true, now: LATEST },
    )
    const [shown] = await db.taskProposals.toArray()
    expect(await rejectProposal2(shown, LATEST)).toEqual({ ok: true, value: 1 })
    expect(await confirmProposal2(shown, LATEST)).toMatchObject({ ok: false })
    expect((await db.tasks.get(task.id))?.state).toBe('open')
    expect(await db.tasks.count()).toBe(1)
  })

  it('Done on a stale copy keeps what a stored run added since (sources)', async () => {
    await startHarness2(NOW)
    await applyHarnessReply2(firstReply, { store: true, now: LATER })
    const [shown] = await db.tasks.toArray()
    await db.tasks.update(shown.id, { sourceEntryIds: [N1, N2, 'a0000000-0000-4000-8000-000000000003'], updatedAt: LATEST })
    expect(await setTaskState2(shown, 'done', null, LATEST)).toMatchObject({ ok: true })
    expect((await db.tasks.get(shown.id))).toMatchObject({ state: 'done', sourceEntryIds: [N1, N2, 'a0000000-0000-4000-8000-000000000003'] })
  })

  it('a Task that arrives while the owner edits is not read as a removed line', async () => {
    await addTask2('Water the plants', null, NOW)
    const shown = today(await loadHarnessData2(), NOW).tasks
    await addTask2('Call the dentist', null, LATER) // lands while the owner edits (a sync, another tab)
    expect(await saveSummary(shown, 'Water the plants', LATER)).toEqual({ ok: true, value: 0 })
    const after = await loadHarnessData2()
    expect(after.tasks.find((t) => t.text === 'Call the dentist')).toMatchObject({ followUpOn: null })
    expect(after.questions).toEqual([])
  })

  it('a summary saved over a shown Task that changed meanwhile is refused, and writes nothing', async () => {
    await addTask2('Water the plants', null, NOW)
    const shown = today(await loadHarnessData2(), NOW).tasks
    await db.tasks.update(shown[0].id, { text: 'Water the garden', updatedAt: LATER })
    const before = await db.outbox.count()
    expect(await saveSummary(shown, 'Water the plants daily', LATEST)).toEqual({ ok: false, error: expect.stringContaining('changed while you were editing') })
    expect(await db.outbox.count()).toBe(before)
    expect((await db.tasks.get(shown[0].id))?.text).toBe('Water the garden')
  })

  it('harnessWork counts without touching the waiting run', async () => {
    const c = (await startHarness2(NOW))!
    expect(harnessWork(await loadHarnessData2(), NOW)).toEqual({ notes: 2, tasks: 0 })
    expect(pendingHarness2()).toEqual(c.header)
  })
})
