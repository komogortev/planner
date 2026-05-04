import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { dedupeCategoriesInDb } from '../cleanup'
import { db } from '../index'
import type { Category, Commitment, Intention, MarketEntry } from '../schema'

function cat(id: string, label: string, sortOrder: number, createdAt: string): Category {
  return { id, label, sortOrder, createdAt, updatedAt: createdAt }
}

function makeIntention(id: string, categoryId: string | null): Intention {
  return {
    id,
    label: `Intention ${id}`,
    targetBudget: null,
    status: 'considering',
    notes: '',
    categoryId,
    tags: [],
    createdAt: '2026-04-28T00:00:00Z',
    updatedAt: '2026-04-28T00:00:00Z',
  }
}

function makeCommitment(id: string, categoryId: string | null): Commitment {
  return {
    id,
    type: 'subscription',
    label: `Commit ${id}`,
    startDate: '2026-04-01',
    principal: 100,
    annualRate: 0,
    termMonths: 12,
    paymentDay: 1,
    notes: '',
    categoryId,
    tags: [],
    createdAt: '2026-04-28T00:00:00Z',
    updatedAt: '2026-04-28T00:00:00Z',
  }
}

function makeMarketEntry(id: string, intentionId: string, categoryId: string | null): MarketEntry {
  return {
    id,
    intentionId,
    observedAt: '2026-04-28',
    pricePoint: 100,
    source: 'x',
    availability: 'in-stock',
    notes: '',
    categoryId,
    tags: [],
    createdAt: '2026-04-28T00:00:00Z',
  }
}

describe('dedupeCategoriesInDb', () => {
  beforeEach(async () => {
    // Open the DB fresh for each test (Dexie auto-opens on first access).
    await db.open()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('is a no-op when no duplicates exist', async () => {
    await db.categories.bulkAdd([
      cat('cat-purchases', 'Purchases', 0, 'a'),
      cat('cat-travel', 'Travel', 1, 'a'),
      cat('user-1', 'home', 100, 'a'),
    ])
    const result = await dedupeCategoriesInDb()
    expect(result).toEqual({ mergedGroups: 0, removedRows: 0, mergedLabels: [] })
    expect(await db.categories.count()).toBe(3)
  })

  it('merges duplicate user categories by lowercased label and reassigns FKs', async () => {
    // 3 "home" rows from a buggy v3 upgrade.
    await db.categories.bulkAdd([
      cat('cat-purchases', 'Purchases', 0, 'a'),
      cat('home-1', 'home', 100, '2026-04-28T00:00:00Z'),
      cat('home-2', 'Home', 100, '2026-04-28T00:00:01Z'),
      cat('home-3', 'HOME', 100, '2026-04-28T00:00:02Z'),
    ])
    await db.intentions.bulkAdd([
      makeIntention('i1', 'home-1'),
      makeIntention('i2', 'home-2'),
      makeIntention('i3', 'home-3'),
    ])
    await db.commitments.bulkAdd([makeCommitment('c1', 'home-2')])
    await db.marketEntries.bulkAdd([makeMarketEntry('m1', 'i1', 'home-3')])

    const result = await dedupeCategoriesInDb()
    expect(result.mergedGroups).toBe(1)
    expect(result.removedRows).toBe(2)
    expect(result.mergedLabels).toEqual(['home'])

    // Earliest createdAt (home-1) wins as canonical.
    const remaining = await db.categories.toArray()
    expect(remaining.map((c) => c.id).sort()).toEqual(['cat-purchases', 'home-1'])

    const intentions = await db.intentions.toArray()
    for (const i of intentions) {
      expect(i.categoryId).toBe('home-1')
    }
    expect((await db.commitments.get('c1'))!.categoryId).toBe('home-1')
    expect((await db.marketEntries.get('m1'))!.categoryId).toBe('home-1')
  })

  it('keeps a built-in as canonical when a user dupe shares its label', async () => {
    // User category accidentally named "Travel" — built-in should win.
    await db.categories.bulkAdd([
      cat('cat-travel', 'Travel', 1, '2026-04-20T00:00:00Z'),
      cat('user-travel', 'travel', 100, '2026-04-19T00:00:00Z'), // earlier createdAt
    ])
    await db.intentions.bulkAdd([makeIntention('i1', 'user-travel')])

    const result = await dedupeCategoriesInDb()
    expect(result.mergedGroups).toBe(1)
    expect(result.removedRows).toBe(1)

    const remaining = await db.categories.toArray()
    expect(remaining.map((c) => c.id)).toEqual(['cat-travel'])
    expect((await db.intentions.get('i1'))!.categoryId).toBe('cat-travel')
  })

  it('handles multiple independent groups in one pass', async () => {
    await db.categories.bulkAdd([
      cat('home-1', 'home', 100, '2026-04-28T00:00:00Z'),
      cat('home-2', 'Home', 100, '2026-04-28T00:00:01Z'),
      cat('hobby-1', 'hobby', 100, '2026-04-28T00:00:00Z'),
      cat('hobby-2', 'Hobby', 100, '2026-04-28T00:00:01Z'),
      cat('hobby-3', 'HOBBY', 100, '2026-04-28T00:00:02Z'),
      cat('vehicle-1', 'vehicle', 100, '2026-04-28T00:00:00Z'),
    ])
    const result = await dedupeCategoriesInDb()
    expect(result.mergedGroups).toBe(2)
    expect(result.removedRows).toBe(3)
    expect(new Set(result.mergedLabels)).toEqual(new Set(['home', 'hobby']))

    const remaining = (await db.categories.toArray()).map((c) => c.id).sort()
    expect(remaining).toEqual(['hobby-1', 'home-1', 'vehicle-1'])
  })

  it('is idempotent — running twice in a row yields no-op the second time', async () => {
    await db.categories.bulkAdd([
      cat('home-1', 'home', 100, '2026-04-28T00:00:00Z'),
      cat('home-2', 'Home', 100, '2026-04-28T00:00:01Z'),
    ])
    const first = await dedupeCategoriesInDb()
    expect(first.mergedGroups).toBe(1)
    const second = await dedupeCategoriesInDb()
    expect(second).toEqual({ mergedGroups: 0, removedRows: 0, mergedLabels: [] })
  })
})
