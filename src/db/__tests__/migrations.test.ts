import { describe, it, expect } from 'vitest'
import {
  backfillCommitmentRow,
  backfillMarketEntryRow,
  migrateIntentionRow,
  migrateSnapshotV1ToV2,
  type SnapshotV1Loose,
} from '../migrations'
import { BUILT_IN_CATEGORIES } from '../categorySeed'

describe('backfillCommitmentRow', () => {
  it('adds categoryId: null and tags: []', () => {
    const v1 = {
      id: 'c1', type: 'mortgage', label: 'House', startDate: '2025-09-01',
      principal: 350000, annualRate: 0.0475, termMonths: 300, paymentDay: 15,
      notes: 'fixed-rate', createdAt: 'a', updatedAt: 'b',
    }
    const v2 = backfillCommitmentRow(v1)
    expect(v2.categoryId).toBeNull()
    expect(v2.tags).toEqual([])
    // existing fields preserved
    expect(v2.label).toBe('House')
    expect(v2.principal).toBe(350000)
  })
})

describe('backfillMarketEntryRow', () => {
  it('adds categoryId: null and tags: []', () => {
    const v1 = {
      id: 'm1', intentionId: 'i1', observedAt: '2026-04-22', pricePoint: 100,
      source: 'x', availability: 'in-stock', notes: '', createdAt: 'a',
    }
    const v2 = backfillMarketEntryRow(v1)
    expect(v2.categoryId).toBeNull()
    expect(v2.tags).toEqual([])
    expect(v2.pricePoint).toBe(100)
  })
})

describe('migrateIntentionRow', () => {
  const baseV1 = {
    id: 'i1', label: 'Bike', targetBudget: 2500, status: 'researching',
    notes: '', createdAt: 'a', updatedAt: 'b',
  }

  it('maps a built-in label match (case-insensitive) to the built-in id', () => {
    const out = migrateIntentionRow(
      { ...baseV1, category: 'Travel' },
      {
        builtIns: BUILT_IN_CATEGORIES,
        createUserCategory: () => {
          throw new Error('should not be called for built-in match')
        },
      },
    )
    expect(out.categoryId).toBe('cat-travel')
    expect(out.tags).toEqual([])
    expect((out as Record<string, unknown>).category).toBeUndefined()
  })

  it('matches case-insensitively', () => {
    const out = migrateIntentionRow(
      { ...baseV1, category: 'PURCHASES' },
      {
        builtIns: BUILT_IN_CATEGORIES,
        createUserCategory: () => 'should-not-fire',
      },
    )
    expect(out.categoryId).toBe('cat-purchases')
  })

  it('creates a user category for unmatched free text', () => {
    let createdLabel = ''
    const out = migrateIntentionRow(
      { ...baseV1, category: 'home gear' },
      {
        builtIns: BUILT_IN_CATEGORIES,
        createUserCategory: (label) => {
          createdLabel = label
          return 'new-id-123'
        },
      },
    )
    expect(out.categoryId).toBe('new-id-123')
    expect(createdLabel).toBe('home gear')
  })

  it('maps empty / whitespace-only category to null without creating', () => {
    const out = migrateIntentionRow(
      { ...baseV1, category: '   ' },
      {
        builtIns: BUILT_IN_CATEGORIES,
        createUserCategory: () => {
          throw new Error('should not be called for empty')
        },
      },
    )
    expect(out.categoryId).toBeNull()
  })
})

describe('migrateSnapshotV1ToV2', () => {
  function v1Fixture(): SnapshotV1Loose {
    return {
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-04-22T14:30:00Z',
      deviceId: 'desktop-2026-04-22',
      recordCounts: { commitments: 1, payments: 1, intentions: 3, marketEntries: 1 },
      commitments: [
        {
          id: 'c1', type: 'mortgage', label: 'House', startDate: '2025-09-01',
          principal: 350000, annualRate: 0.0475, termMonths: 300, paymentDay: 15,
          notes: '', createdAt: 'a', updatedAt: 'b',
        },
      ],
      payments: [
        { id: 'p1', commitmentId: 'c1', date: '2026-04-15', amount: 1824.5,
          principalPortion: 824.5, interestPortion: 1000, balanceAfter: 349175.5,
          notes: '', createdAt: '' },
      ],
      intentions: [
        // built-in match
        { id: 'i1', label: 'E-bike', category: 'Travel', targetBudget: 2500,
          status: 'researching', notes: '', createdAt: 'a', updatedAt: 'b' },
        // unmatched free text → new user category
        { id: 'i2', label: 'Drone', category: 'home gear', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
        // empty category → null
        { id: 'i3', label: 'Untyped', category: '', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
      ],
      marketEntries: [
        { id: 'm1', intentionId: 'i1', observedAt: '2026-04-22', pricePoint: 2799,
          source: 'canyon.com', availability: 'in-stock', notes: '', createdAt: 'a' },
      ],
    }
  }

  it('produces a v2 snapshot with built-ins seeded + matched ids + new user category', () => {
    const v1 = v1Fixture()
    const out = migrateSnapshotV1ToV2(v1, () => '2026-04-28T20:00:00Z')

    expect(out.schemaVersion).toBe(2)
    // 4 built-ins + 1 user category from "home gear"
    expect(out.categories.length).toBe(5)
    expect(out.categories.map((c) => c.id)).toContain('cat-travel')
    expect(out.categories.map((c) => c.label)).toContain('home gear')

    // Intentions mapped correctly
    expect(out.intentions[0]!.categoryId).toBe('cat-travel')
    const homeGearCat = out.categories.find((c) => c.label === 'home gear')!
    expect(out.intentions[1]!.categoryId).toBe(homeGearCat.id)
    expect(out.intentions[2]!.categoryId).toBeNull()

    // Old `category` field stripped on every intention
    for (const i of out.intentions) {
      expect((i as Record<string, unknown>).category).toBeUndefined()
      expect(i.tags).toEqual([])
    }

    // Commitments + marketEntries backfilled
    expect(out.commitments[0]).toMatchObject({ categoryId: null, tags: [] })
    expect(out.marketEntries[0]).toMatchObject({ categoryId: null, tags: [] })

    // recordCounts updated to reflect new entity types
    expect(out.recordCounts).toEqual({
      commitments: 1,
      payments: 1,
      intentions: 3,
      marketEntries: 1,
      categories: 5,
      themes: 0,
      themeMembers: 0,
    })

    // Themes / themeMembers empty
    expect(out.themes).toEqual([])
    expect(out.themeMembers).toEqual([])

    // Forwarded scalar fields untouched
    expect(out.deviceId).toBe('desktop-2026-04-22')
    expect(out.exportedAt).toBe('2026-04-22T14:30:00Z')
  })

  // Regression for the duplicate-categories bug (2026-04-29). Earlier
  // versions of `migrateSnapshotV1ToV2` called `createUserCategory` once per
  // intention row without deduping by lowercased label, so 5 intentions
  // tagged "home" produced 5 separate `home` rows.
  it('dedupes user categories by lowercased label across intentions', () => {
    const v1: SnapshotV1Loose = {
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-04-29T00:00:00Z',
      deviceId: 'desktop-2026-04-29',
      recordCounts: { commitments: 0, payments: 0, intentions: 5, marketEntries: 0 },
      commitments: [], payments: [], marketEntries: [],
      intentions: [
        { id: 'i1', label: 'A', category: 'home', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
        { id: 'i2', label: 'B', category: 'Home', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
        { id: 'i3', label: 'C', category: 'HOME', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
        { id: 'i4', label: 'D', category: 'hobby', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
        { id: 'i5', label: 'E', category: 'hobby', targetBudget: null,
          status: 'considering', notes: '', createdAt: 'a', updatedAt: 'b' },
      ],
    }
    const out = migrateSnapshotV1ToV2(v1, () => '2026-04-29T00:00:00Z')

    // 4 built-ins + 1 "home" + 1 "hobby" = 6 categories total
    expect(out.categories.length).toBe(6)
    const userCats = out.categories.filter(
      (c) => c.id !== 'cat-purchases'
        && c.id !== 'cat-travel'
        && c.id !== 'cat-skill-development'
        && c.id !== 'cat-subscriptions',
    )
    expect(userCats.length).toBe(2)
    const homeRows = userCats.filter((c) => c.label.toLowerCase() === 'home')
    const hobbyRows = userCats.filter((c) => c.label.toLowerCase() === 'hobby')
    expect(homeRows.length).toBe(1)
    expect(hobbyRows.length).toBe(1)

    // First-seen label spelling wins (label preserved as-is from first occurrence)
    expect(homeRows[0]!.label).toBe('home')

    // All three "home"-flavoured intentions point to the same id
    const homeId = homeRows[0]!.id
    expect(out.intentions[0]!.categoryId).toBe(homeId)
    expect(out.intentions[1]!.categoryId).toBe(homeId)
    expect(out.intentions[2]!.categoryId).toBe(homeId)
    // Both "hobby" intentions share an id
    const hobbyId = hobbyRows[0]!.id
    expect(out.intentions[3]!.categoryId).toBe(hobbyId)
    expect(out.intentions[4]!.categoryId).toBe(hobbyId)
  })

  it('seeds built-ins even when there are no intentions', () => {
    const v1: SnapshotV1Loose = {
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-04-22T14:30:00Z',
      deviceId: 'desktop-2026-04-22',
      recordCounts: { commitments: 0, payments: 0, intentions: 0, marketEntries: 0 },
      commitments: [], payments: [], intentions: [], marketEntries: [],
    }
    const out = migrateSnapshotV1ToV2(v1)
    expect(out.categories.length).toBe(4)
    expect(out.recordCounts.categories).toBe(4)
  })
})
