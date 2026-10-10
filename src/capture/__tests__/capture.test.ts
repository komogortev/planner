import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { captureEntry } from '../capture'
import { db } from '@/db'

beforeEach(async () => {
  await db.entries.clear()
  await db.outbox.clear()
})

describe('captureEntry', () => {
  it('commits the entry and its outbox row together, payload = the full entry', async () => {
    const r = await captureEntry('  buy milk\r\nand eggs  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await db.entries.count()).toBe(1)
    const rows = await db.outbox.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.op).toBe('upsert')
    expect(rows[0]!.payload.id).toBe(r.entry.id)
    expect(rows[0]!.payload.body).toBe('  buy milk\nand eggs') // CR stripped, trailing space trimmed, leading kept (owner text)
    expect(rows[0]!.payload).not.toHaveProperty('serverVersion')
    expect((await db.entries.toArray())[0]!.serverVersion).toBeNull()
  })

  it('negative control: empty or whitespace-only input writes nothing', async () => {
    for (const raw of ['', '   ', '\n\t']) {
      expect((await captureEntry(raw)).ok).toBe(false)
    }
    expect(await db.entries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('negative control: over-limit text writes nothing', async () => {
    expect((await captureEntry('x'.repeat(20_001))).ok).toBe(false)
    expect(await db.entries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('atomic: a failing outbox write rolls the entry back', async () => {
    const orig = db.outbox.add.bind(db.outbox)
    db.outbox.add = (() => Promise.reject(new Error('boom'))) as typeof db.outbox.add
    try {
      await expect(captureEntry('hello')).rejects.toThrow('boom')
    } finally {
      db.outbox.add = orig
    }
    expect(await db.entries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})
