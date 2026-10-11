import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { movedFacts, onlyHereWarning } from '../movedFacts'
import { db } from '@/db'
import { captureEntry } from '@/capture/capture'

// The suite runs in node: a minimal localStorage, enough for the draft the capture box keeps.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
  configurable: true,
})

beforeEach(async () => {
  localStorage.clear()
  await Promise.all([db.entries.clear(), db.outbox.clear(), db.syncMeta.clear()])
})

describe('movedFacts', () => {
  it('an empty device: nothing to say', async () => {
    const f = await movedFacts()
    expect(f).toEqual({ notes: 0, unsynced: 0, draft: false })
    expect(onlyHereWarning(f)).toBe('')
  })

  it('counts notes and the ones never uploaded, and names them', async () => {
    await captureEntry('one')
    await captureEntry('two')
    const f = await movedFacts()
    expect(f.notes).toBe(2)
    expect(f.unsynced).toBe(2) // a fresh capture waits in the outbox until the server acknowledges it
    expect(onlyHereWarning(f)).toContain('2 notes were never uploaded')
    expect(onlyHereWarning(f)).toContain('exist only on this device')
  })

  it('a synced note is counted but not warned about', async () => {
    await captureEntry('synced')
    await db.outbox.clear() // what an acknowledged push leaves behind
    const f = await movedFacts()
    expect(f).toMatchObject({ notes: 1, unsynced: 0 })
    expect(onlyHereWarning(f)).toBe('')
  })

  it('an unsent draft or a single note is worded for what it is', () => {
    expect(onlyHereWarning({ notes: 0, unsynced: 0, draft: true })).toContain('unsent draft')
    expect(onlyHereWarning({ notes: 0, unsynced: 1, draft: false })).toContain('1 note was never uploaded')
  })

  it('read-only: counting writes nothing', async () => {
    await captureEntry('x')
    const before = [await db.entries.count(), await db.outbox.count()]
    await movedFacts()
    expect([await db.entries.count(), await db.outbox.count()]).toEqual(before)
  })
})
