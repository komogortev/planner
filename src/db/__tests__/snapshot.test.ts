import { describe, it, expect } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  SnapshotValidationError,
  parseSnapshot,
  validateSnapshot,
} from '../snapshot'

function makeMinimal(): unknown {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: '0.1.0',
    exportedAt: '2026-04-26T18:42:13Z',
    deviceId: 'desktop-2026-04-26',
    recordCounts: { commitments: 0, payments: 0, intentions: 0, marketEntries: 0 },
    commitments: [],
    payments: [],
    intentions: [],
    marketEntries: [],
  }
}

function makeRealistic(): unknown {
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
        id: 'i1', label: 'E-bike', category: 'transport', targetBudget: 2500,
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

describe('parseSnapshot', () => {
  it('parses a valid minimal empty snapshot', () => {
    const snap = parseSnapshot(JSON.stringify(makeMinimal()))
    expect(snap.schemaVersion).toBe(1)
    expect(snap.commitments).toEqual([])
    expect(snap.recordCounts.commitments).toBe(0)
  })

  it('parses a valid snapshot with realistic record counts', () => {
    const snap = parseSnapshot(JSON.stringify(makeRealistic()))
    expect(snap.commitments).toHaveLength(1)
    expect(snap.payments[0]!.principalPortion).toBe(824.5)
    expect(snap.commitments[0]!.notes).toContain('🏠')
  })

  it('rejects invalid JSON', () => {
    expect(() => parseSnapshot('{not json')).toThrow(SnapshotValidationError)
    try {
      parseSnapshot('{not json')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('invalid-json')
    }
  })

  it('rejects a snapshot missing recordCounts', () => {
    const bad = makeMinimal() as Record<string, unknown>
    delete bad.recordCounts
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('wrong-shape')
    }
  })

  it('rejects a snapshot whose commitments field is not an array', () => {
    const bad = makeMinimal() as Record<string, unknown>
    bad.commitments = 'oops'
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('wrong-shape')
    }
  })

  it('rejects a payment missing principalPortion', () => {
    const bad = makeRealistic() as Record<string, unknown>
    const payments = bad.payments as Array<Record<string, unknown>>
    delete payments[0]!.principalPortion
    // also bump recordCounts to match length so we hit derived-fields, not count-mismatch
    try {
      parseSnapshot(JSON.stringify(bad))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('missing-derived-fields')
    }
  })
})

describe('validateSnapshot', () => {
  it('accepts a valid current-version snapshot', () => {
    const snap = parseSnapshot(JSON.stringify(makeRealistic()))
    expect(() => validateSnapshot(snap)).not.toThrow()
  })

  it('rejects schemaVersion > current', () => {
    const newer = makeMinimal() as Record<string, unknown>
    newer.schemaVersion = CURRENT_SCHEMA_VERSION + 1
    const snap = parseSnapshot(JSON.stringify(newer))
    try {
      validateSnapshot(snap)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('newer-version')
    }
  })

  it('rejects a recordCounts mismatch', () => {
    const bad = makeRealistic() as Record<string, unknown>
    ;(bad.recordCounts as Record<string, number>).commitments = 99
    const snap = parseSnapshot(JSON.stringify(bad))
    try {
      validateSnapshot(snap)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as SnapshotValidationError).kind).toBe('count-mismatch')
    }
  })
})
