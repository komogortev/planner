import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  SnapshotValidationError,
  buildSnapshot,
  parseSnapshot,
  serializeSnapshot,
  validateSnapshot,
} from '../snapshot'
import { db } from '../index'

/**
 * Minimal valid v2 snapshot — empty arrays for all 7 entity types, recordCounts
 * all zero. Used as a starting point for shape-validation tests.
 */
function makeMinimalV2(): unknown {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: '0.2.0',
    exportedAt: '2026-04-28T18:42:13Z',
    deviceId: 'desktop-2026-04-28',
    recordCounts: {
      commitments: 0,
      payments: 0,
      intentions: 0,
      marketEntries: 0,
      categories: 0,
      themes: 0,
      themeMembers: 0,
    },
    commitments: [],
    payments: [],
    intentions: [],
    marketEntries: [],
    categories: [],
    themes: [],
    themeMembers: [],
  }
}

/**
 * v1 snapshot fixture — intention with free-text `category: 'Travel'` matching
 * a built-in label, exercises the forward-migration path on parseSnapshot.
 */
function makeRealisticV1(): unknown {
  return {
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: '2026-04-26T18:42:13Z',
    deviceId: 'desktop-2026-04-26',
    recordCounts: { commitments: 1, payments: 1, intentions: 1, marketEntries: 1 },
    commitments: [
      {
        id: 'c1', type: 'mortgage', label: 'House', startDate: '2025-09-01',
        principal: 350000, annualRate: 0.0475, termMonths: 300, paymentDay: 15,
        notes: 'fixed-rate — café 🏠', // non-ASCII to exercise utf-8 paths
        createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
      },
    ],
    payments: [
      {
        id: 'p1', commitmentId: 'c1', date: '2026-04-15', amount: 1824.5,
        principalPortion: 824.5, interestPortion: 1000, balanceAfter: 349175.5,
        notes: '', createdAt: '2026-04-15T18:00:00Z',
      },
    ],
    intentions: [
      {
        id: 'i1', label: 'E-bike', category: 'Travel', targetBudget: 2500,
        status: 'researching', notes: '',
        createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
      },
    ],
    marketEntries: [
      {
        id: 'm1', intentionId: 'i1', observedAt: '2026-04-22', pricePoint: 2799,
        source: 'canyon.com', availability: 'in-stock', notes: '',
        createdAt: '2026-04-22T14:30:00Z',
      },
    ],
  }
}

/**
 * Realistic v2 snapshot — already migrated, used for round-trip + happy path tests.
 */
function makeRealisticV2(): unknown {
  return {
    schemaVersion: 2,
    appVersion: '0.2.0',
    exportedAt: '2026-04-28T18:42:13Z',
    deviceId: 'desktop-2026-04-28',
    recordCounts: {
      commitments: 1, payments: 1, intentions: 1, marketEntries: 1,
      categories: 4, themes: 0, themeMembers: 0,
    },
    commitments: [
      {
        id: 'c1', type: 'mortgage', label: 'House', startDate: '2025-09-01',
        principal: 350000, annualRate: 0.0475, termMonths: 300, paymentDay: 15,
        notes: 'fixed-rate — café 🏠',
        categoryId: null, tags: [],
        createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
      },
    ],
    payments: [
      {
        id: 'p1', commitmentId: 'c1', date: '2026-04-15', amount: 1824.5,
        principalPortion: 824.5, interestPortion: 1000, balanceAfter: 349175.5,
        notes: '', createdAt: '2026-04-15T18:00:00Z',
      },
    ],
    intentions: [
      {
        id: 'i1', label: 'E-bike', targetBudget: 2500,
        status: 'researching', notes: '',
        categoryId: 'cat-travel', tags: [],
        createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
      },
    ],
    marketEntries: [
      {
        id: 'm1', intentionId: 'i1', observedAt: '2026-04-22', pricePoint: 2799,
        source: 'canyon.com', availability: 'in-stock', notes: '',
        categoryId: null, tags: [],
        createdAt: '2026-04-22T14:30:00Z',
      },
    ],
    categories: [
      { id: 'cat-purchases', label: 'Purchases', sortOrder: 0, createdAt: '2026-04-28T18:00:00Z', updatedAt: '2026-04-28T18:00:00Z' },
      { id: 'cat-travel', label: 'Travel', sortOrder: 1, createdAt: '2026-04-28T18:00:00Z', updatedAt: '2026-04-28T18:00:00Z' },
      { id: 'cat-skill-development', label: 'Skill development', sortOrder: 2, createdAt: '2026-04-28T18:00:00Z', updatedAt: '2026-04-28T18:00:00Z' },
      { id: 'cat-subscriptions', label: 'Subscriptions', sortOrder: 3, createdAt: '2026-04-28T18:00:00Z', updatedAt: '2026-04-28T18:00:00Z' },
    ],
    themes: [],
    themeMembers: [],
  }
}

describe('parseSnapshot', () => {
  it('parses a valid minimal empty v2 snapshot', () => {
    const snap = parseSnapshot(JSON.stringify(makeMinimalV2()))
    expect(snap.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(snap.commitments).toEqual([])
    expect(snap.categories).toEqual([])
    expect(snap.recordCounts.themeMembers).toBe(0)
  })

  it('parses a valid v2 snapshot with realistic record counts', () => {
    const snap = parseSnapshot(JSON.stringify(makeRealisticV2()))
    expect(snap.commitments).toHaveLength(1)
    expect(snap.payments[0]!.principalPortion).toBe(824.5)
    expect(snap.commitments[0]!.notes).toContain('🏠')
    expect(snap.categories).toHaveLength(4)
    expect(snap.intentions[0]!.categoryId).toBe('cat-travel')
  })

  it('forward-migrates a v1 snapshot through parseSnapshot', () => {
    const v1 = makeRealisticV1()
    const snap = parseSnapshot(JSON.stringify(v1))
    expect(snap.schemaVersion).toBe(2)
    // Built-ins seeded.
    expect(snap.categories.length).toBeGreaterThanOrEqual(4)
    expect(snap.categories.find((c) => c.id === 'cat-travel')).toBeDefined()
    // Intention free-text "Travel" matched the cat-travel built-in.
    expect(snap.intentions[0]!.categoryId).toBe('cat-travel')
    // Commitments / marketEntries backfilled.
    expect(snap.commitments[0]).toMatchObject({ categoryId: null, tags: [] })
    expect(snap.marketEntries[0]).toMatchObject({ categoryId: null, tags: [] })
    // recordCounts updated to reflect new entity types.
    expect(snap.recordCounts.categories).toBe(snap.categories.length)
    expect(snap.recordCounts.themes).toBe(0)
    expect(snap.recordCounts.themeMembers).toBe(0)
  })

  it('rejects invalid JSON', () => {
    expect(() => parseSnapshot('{not json')).toThrow(SnapshotValidationError)
    try {
      parseSnapshot('{not json')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('invalid-json')
    }
  })

  it('rejects a v2 snapshot missing recordCounts', () => {
    const bad = makeMinimalV2() as Record<string, unknown>
    delete bad.recordCounts
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('wrong-shape')
    }
  })

  it('rejects a v2 snapshot whose categories field is not an array', () => {
    const bad = makeMinimalV2() as Record<string, unknown>
    bad.categories = 'oops'
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('wrong-shape')
    }
  })

  it('rejects a v2 snapshot missing the new categories recordCount key', () => {
    const bad = makeMinimalV2() as Record<string, unknown>
    delete (bad.recordCounts as Record<string, unknown>).categories
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('wrong-shape')
    }
  })

  it('rejects a payment missing principalPortion (post-migration)', () => {
    const bad = makeRealisticV2() as Record<string, unknown>
    const payments = bad.payments as Array<Record<string, unknown>>
    delete payments[0]!.principalPortion
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('missing-derived-fields')
    }
  })
})

describe('serializeSnapshot round-trip', () => {
  it('parseSnapshot(serializeSnapshot(s)) deeply equals s for v2', () => {
    const original = parseSnapshot(JSON.stringify(makeRealisticV2()))
    const round = parseSnapshot(serializeSnapshot(original))
    expect(round).toEqual(original)
  })

  it('produces 2-space indented JSON per STORAGE-FORMAT.md', () => {
    const snap = parseSnapshot(JSON.stringify(makeMinimalV2()))
    const text = serializeSnapshot(snap)
    expect(text.split('\n')[1]).toMatch(/^  "/) // second line indented 2 spaces
  })

  it('preserves non-ASCII characters through round-trip', () => {
    const original = parseSnapshot(JSON.stringify(makeRealisticV2()))
    const round = parseSnapshot(serializeSnapshot(original))
    expect(round.commitments[0]!.notes).toContain('🏠')
    expect(round.commitments[0]!.notes).toContain('café')
  })
})

describe('buildSnapshot', () => {
  beforeEach(async () => {
    await db.commitments.clear()
    await db.payments.clear()
    await db.intentions.clear()
    await db.marketEntries.clear()
    await db.categories.clear()
    await db.themes.clear()
    await db.themeMembers.clear()
  })

  afterEach(async () => {
    await db.commitments.clear()
    await db.payments.clear()
    await db.intentions.clear()
    await db.marketEntries.clear()
    await db.categories.clear()
    await db.themes.clear()
    await db.themeMembers.clear()
  })

  it('returns an empty v2 snapshot from an empty DB', async () => {
    const snap = await buildSnapshot('desktop-2026-04-28', '0.2.0')
    expect(snap.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(snap.deviceId).toBe('desktop-2026-04-28')
    expect(snap.appVersion).toBe('0.2.0')
    expect(snap.recordCounts).toEqual({
      commitments: 0, payments: 0, intentions: 0, marketEntries: 0,
      categories: 0, themes: 0, themeMembers: 0,
    })
    expect(snap.commitments).toEqual([])
    expect(snap.categories).toEqual([])
  })

  it('returns recordCounts that match array lengths after seeding (incl. v3 tables)', async () => {
    await db.categories.add({
      id: 'cat-purchases', label: 'Purchases', sortOrder: 0,
      createdAt: '2026-04-28T18:00:00Z', updatedAt: '2026-04-28T18:00:00Z',
    })
    await db.commitments.add({
      id: 'c1', type: 'mortgage', label: 'House', startDate: '2025-09-01',
      principal: 350000, annualRate: 0.0475, termMonths: 300, paymentDay: 15,
      notes: '', categoryId: null, tags: [],
      createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
    })
    await db.payments.add({
      id: 'p1', commitmentId: 'c1', date: '2026-04-15', amount: 1824.5,
      principalPortion: 824.5, interestPortion: 1000, balanceAfter: 349175.5,
      notes: '', createdAt: '2026-04-15T18:00:00Z',
    })
    await db.intentions.add({
      id: 'i1', label: 'Bike', targetBudget: 2500,
      status: 'researching', notes: '',
      categoryId: 'cat-purchases', tags: ['urgent'],
      createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
    })
    const snap = await buildSnapshot('phone-2026-04-26', '0.2.0')
    expect(snap.recordCounts).toEqual({
      commitments: 1, payments: 1, intentions: 1, marketEntries: 0,
      categories: 1, themes: 0, themeMembers: 0,
    })
    expect(snap.commitments).toHaveLength(1)
    expect(snap.payments).toHaveLength(1)
    expect(snap.intentions).toHaveLength(1)
    expect(snap.intentions[0]!.tags).toEqual(['urgent'])
    expect(snap.categories).toHaveLength(1)
  })

  it('produces a snapshot that round-trips through parse + validate', async () => {
    await db.commitments.add({
      id: 'c1', type: 'mortgage', label: 'House', startDate: '2025-09-01',
      principal: 350000, annualRate: 0.0475, termMonths: 300, paymentDay: 15,
      notes: 'café 🏠', categoryId: null, tags: [],
      createdAt: '2026-04-22T14:30:00Z', updatedAt: '2026-04-22T14:30:00Z',
    })
    const snap = await buildSnapshot('desktop-2026-04-28', '0.2.0')
    const text = serializeSnapshot(snap)
    const round = parseSnapshot(text)
    expect(() => validateSnapshot(round)).not.toThrow()
    expect(round.commitments[0]!.notes).toBe('café 🏠')
  })
})

describe('validateSnapshot', () => {
  it('accepts a valid current-version (v2) snapshot', () => {
    const snap = parseSnapshot(JSON.stringify(makeRealisticV2()))
    expect(() => validateSnapshot(snap)).not.toThrow()
  })

  it('rejects schemaVersion > current', () => {
    const newer = makeMinimalV2() as Record<string, unknown>
    newer.schemaVersion = CURRENT_SCHEMA_VERSION + 1
    const snap = parseSnapshot(JSON.stringify(newer))
    try {
      validateSnapshot(snap)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('newer-version')
    }
  })

  it('rejects a recordCounts mismatch (commitments)', () => {
    const bad = makeRealisticV2() as Record<string, unknown>
    ;(bad.recordCounts as Record<string, number>).commitments = 99
    const snap = parseSnapshot(JSON.stringify(bad))
    try {
      validateSnapshot(snap)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('count-mismatch')
    }
  })

  it('rejects a recordCounts mismatch (categories — new in v2)', () => {
    const bad = makeRealisticV2() as Record<string, unknown>
    ;(bad.recordCounts as Record<string, number>).categories = 99
    const snap = parseSnapshot(JSON.stringify(bad))
    try {
      validateSnapshot(snap)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('count-mismatch')
    }
  })
})
