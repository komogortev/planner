// System widgets (D-107…D-110): defaults, the row that a toggle writes, and per-account activation through sync.
// Synthetic data only.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { PlannerDb } from '@/db'
import { writeRecords } from '@/db/records'
import { cleanRecord } from '@/domain/records'
import { SyncEngine } from '@/sync/engine'
import { FakeServer } from '@/sync/__tests__/fakeServer'
import { resolveSystemWidgets, SYSTEM_WIDGETS, systemWidgetRow } from '../system'

const NOW = '2026-10-13T18:00:00.000Z'
const LATER = '2026-10-13T19:00:00.000Z'
const byId = (id: string) => SYSTEM_WIDGETS.find((w) => w.id === id)!
const active = (rows: Parameters<typeof resolveSystemWidgets>[0]) => Object.fromEntries(resolveSystemWidgets(rows).map((w) => [w.id, w.active]))

describe('resolveSystemWidgets', () => {
  it('no rows: Today on, Summary and Notes off (D-108…D-110), in Dashboard order', () => {
    expect(resolveSystemWidgets([]).map((w) => [w.name, w.active])).toEqual([['Today', true], ['Summary', false], ['Notes', false]])
  })

  it('a row wins over the default, both ways', () => {
    expect(active([{ id: 'system-today', active: false }, { id: 'system-notes', active: true }])).toEqual({ 'system-today': false, 'system-summary': false, 'system-notes': true })
  })

  it('a deleted row falls back to the default; a row for another id is ignored', () => {
    expect(active([{ id: 'system-today', active: false, deletedAt: NOW }, { id: 'someone-else', active: true }])).toEqual({ 'system-today': true, 'system-summary': false, 'system-notes': false })
  })
})

describe('systemWidgetRow', () => {
  it('passes the record validator the Worker runs (known positive)', () => {
    const row = systemWidgetRow(byId('system-notes'), true, NOW)
    expect(cleanRecord('widget', { ...row, deletedAt: null }).ok).toBe(true)
  })

  it('negative control: the same row with a lens is refused — a system widget holds none', () => {
    const row = { ...systemWidgetRow(byId('system-notes'), true, NOW), lens: { id: 'l1', name: 'x', version: 1, shape: 'markdown', instruction: 'y' } }
    expect(cleanRecord('widget', { ...row, deletedAt: null }).ok).toBe(false)
  })

  it('a second toggle keeps the first creation time and moves only updatedAt', () => {
    const first = systemWidgetRow(byId('system-summary'), true, NOW)
    expect(systemWidgetRow(byId('system-summary'), false, LATER, first)).toMatchObject({ createdAt: NOW, updatedAt: LATER, active: false })
  })
})

let n = 0
function device(server: FakeServer) {
  const db = new PlannerDb(`widgets-device-${++n}`)
  const engine = new SyncEngine({
    db, fetch: server.fetch as typeof fetch, apiUrl: 'https://api.test', token: () => 'tok-a', now: () => 1_000_000, online: () => true, yieldNow: async () => {},
  })
  return { db, engine }
}

describe('per account', () => {
  it('a widget switched on one device is on for the second device after sync', async () => {
    const server = new FakeServer()
    const a = device(server)
    const b = device(server)
    expect(active(await b.db.widgets.toArray())['system-notes']).toBe(false) // known positive: b starts at the default
    const w = await writeRecords(a.db, [{ recordKind: 'widget', row: { ...systemWidgetRow(byId('system-notes'), true, NOW) } }], NOW)
    expect(w).toEqual({ ok: true, written: 1 })
    await a.engine.run()
    await b.engine.run()
    expect(active(await b.db.widgets.toArray())['system-notes']).toBe(true)
  })
})
