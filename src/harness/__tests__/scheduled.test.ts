import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db'
import { recordTables } from '@/db/records'
import type { Entry } from '@/domain/entry'
import type { WaitingReply } from '@/ai/schedules'

const api = vi.hoisted(() => ({
  signedIn: true,
  schedules: [] as { kind: 'morning'; hour: number; zone: string; enabled: boolean }[],
  models: [{ id: 'm1', hasKey: true }] as { id: string; hasKey: boolean }[],
  waiting: [] as unknown[],
  saved: [] as unknown[],
  stored: [] as string[],
}))
vi.mock('@/auth/signIn', () => ({ storedToken: () => (api.signedIn ? 'tok' : null), API_URL: 'https://api.test' }))
vi.mock('@/ai/schedules', () => ({
  listSchedules: async () => ({ schedules: api.schedules, operatorPaused: false }),
  saveMorning: async (c: unknown) => { api.saved.push(c) },
  listWaiting: async () => api.waiting,
}))
vi.mock('@/ai/models', () => ({ listModels: async () => api.models, markStored: async (id: string) => { api.stored.push(id) } }))

import { applyWaitingSchedules, DEFAULT_MORNING_HOUR, ensureMorning } from '../scheduled'
import { clearPending, loadPending2 } from '../pending'
import { startHarness2, pendingHarness2 } from '../loop2'
import { deviceZone } from '../loop'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
  configurable: true,
})

const NOW = '2026-10-11T12:30:00.000Z'
const N1 = 'a0000000-0000-4000-8000-000000000001'
const note = (id: string, createdAt: string, body: string): Entry => ({
  id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, serverVersion: 1,
})
const REPLY = JSON.stringify({ tasks: [{ op: 'create', ref: 't', text: 'Replace the hall bulb', sourceEntryIds: [N1], due: null }], questions: [] })

/** What the Worker's compose step would leave: the header of a run composed from this device's notes, and a model's reply. */
async function aWaitingReply(callId = 'call-1'): Promise<WaitingReply> {
  const composed = (await startHarness2(NOW))!
  clearPending('harness') // the Worker holds the header, not this device
  return { callId, modelId: 'm1', header: composed.header, reply: REPLY, startedAt: 1 }
}

beforeEach(async () => {
  localStorage.clear()
  Object.assign(api, { signedIn: true, schedules: [], models: [{ id: 'm1', hasKey: true }], waiting: [], saved: [], stored: [] })
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear(), ...recordTables(db).map((t) => t.clear())])
  await db.entries.bulkPut([note(N1, '2026-10-11T11:00:00.000Z', 'hall light is out')])
})

describe('applying a waiting scheduled reply (D-135)', () => {
  it('known positive: stores the Task and a model run through the manual path, then marks the call stored', async () => {
    api.waiting = [await aWaitingReply()]
    expect(await applyWaitingSchedules()).toBe(1)
    expect(await db.tasks.count()).toBe(1)
    expect(await db.runs.toArray()).toMatchObject([{ executor: 'model', modelId: 'm1', callId: 'call-1' }])
    expect(api.stored).toEqual(['call-1'])
    expect(pendingHarness2()).toBeNull()
  })

  it('does nothing without a waiting reply, and nothing when signed out', async () => {
    expect(await applyWaitingSchedules()).toBe(0)
    api.waiting = [await aWaitingReply()]
    api.signedIn = false
    expect(await applyWaitingSchedules()).toBe(0)
    expect(await db.tasks.count()).toBe(0)
    expect(api.stored).toEqual([])
  })

  it('never overwrites a run this device is itself waiting on', async () => {
    api.waiting = [await aWaitingReply()]
    const mine = (await startHarness2(NOW))! // a manual run, now waiting for its model
    expect(await applyWaitingSchedules()).toBe(0)
    expect(loadPending2()).toEqual(mine.header)
    expect(api.stored).toEqual([])
    expect(await db.tasks.count()).toBe(0)
  })

  it('a pass already running is shared, so a burst of sync events stores once', async () => {
    api.waiting = [await aWaitingReply()]
    const [a, b] = await Promise.all([applyWaitingSchedules(), applyWaitingSchedules()])
    expect([a, b]).toEqual([1, 1])
    expect(api.stored).toEqual(['call-1'])
  })

  it('leaves a reply that does not store waiting for the next open', async () => {
    const w = await aWaitingReply()
    api.waiting = [{ ...w, reply: 'not json' }]
    expect(await applyWaitingSchedules()).toBe(0)
    expect(api.stored).toEqual([])
    expect(pendingHarness2()).toBeNull() // and the slot is free for a manual run
  })
})

describe('Morning on by default (D-124, D-134)', () => {
  it('creates it at 06:00 in this device’s zone once a model with a key exists', async () => {
    await ensureMorning()
    expect(api.saved).toEqual([{ hour: DEFAULT_MORNING_HOUR, zone: deviceZone(), enabled: true }])
  })

  it('creates nothing without a usable model', async () => {
    api.models = [{ id: 'm1', hasKey: false }]
    await ensureMorning()
    expect(api.saved).toEqual([])
  })

  it('leaves a schedule the owner turned off off, and follows a changed zone', async () => {
    api.schedules = [{ kind: 'morning', hour: 8, zone: deviceZone(), enabled: false }]
    await ensureMorning()
    expect(api.saved).toEqual([])
    api.schedules = [{ kind: 'morning', hour: 8, zone: 'Pacific/Auckland', enabled: false }]
    await ensureMorning()
    expect(api.saved).toEqual([{ zone: deviceZone() }]) // the zone only: it does not turn the schedule on
  })
})
