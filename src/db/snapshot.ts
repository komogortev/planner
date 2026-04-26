/**
 * On-disk snapshot contract for L1 GitHub sync.
 *
 * Pure module — no Dexie, no fetch. Build / parse / validate the `data.json`
 * shape defined in `docs/STORAGE-FORMAT.md`. Easy to unit-test.
 *
 * Failure modes surface as `SnapshotValidationError` with user-facing copy.
 * Restore (S2) and Sync (S3) call into this module.
 */

import type {
  Commitment,
  Intention,
  MarketEntry,
  Payment,
} from './schema'

export const CURRENT_SCHEMA_VERSION = 1

export interface SnapshotCounts {
  commitments: number
  payments: number
  intentions: number
  marketEntries: number
}

export interface Snapshot {
  schemaVersion: number
  appVersion: string
  exportedAt: string
  deviceId: string
  recordCounts: SnapshotCounts
  commitments: Commitment[]
  payments: Payment[]
  intentions: Intention[]
  marketEntries: MarketEntry[]
}

export type SnapshotValidationKind =
  | 'invalid-json'
  | 'wrong-shape'
  | 'newer-version'
  | 'count-mismatch'
  | 'missing-derived-fields'

export class SnapshotValidationError extends Error {
  readonly kind: SnapshotValidationKind
  /** User-facing copy. Safe to render directly. */
  readonly userMessage: string

  constructor(kind: SnapshotValidationKind, userMessage: string) {
    super(userMessage)
    this.name = 'SnapshotValidationError'
    this.kind = kind
    this.userMessage = userMessage
  }
}

/**
 * Parse raw JSON text into a Snapshot. Validates the top-level shape and the
 * presence of required payment-derived fields. Does NOT validate per-entity
 * field types beyond what's needed for safe handling — entity rows are trusted
 * (Q2 resolution: do not recompute derived fields).
 *
 * Throws `SnapshotValidationError`.
 */
export function parseSnapshot(rawText: string): Snapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new SnapshotValidationError(
      'invalid-json',
      'data.json is not valid JSON. Cancelling restore.',
    )
  }

  if (!isObject(parsed)) {
    throw shapeError('top-level value is not an object')
  }

  // Required scalar fields
  if (typeof parsed.schemaVersion !== 'number' || !Number.isInteger(parsed.schemaVersion)) {
    throw shapeError('schemaVersion must be an integer')
  }
  if (typeof parsed.appVersion !== 'string') {
    throw shapeError('appVersion must be a string')
  }
  if (typeof parsed.exportedAt !== 'string') {
    throw shapeError('exportedAt must be a string')
  }
  if (typeof parsed.deviceId !== 'string') {
    throw shapeError('deviceId must be a string')
  }

  // recordCounts shape
  const rc = parsed.recordCounts
  if (!isObject(rc)) {
    throw shapeError('recordCounts must be an object')
  }
  for (const key of ['commitments', 'payments', 'intentions', 'marketEntries'] as const) {
    if (typeof rc[key] !== 'number' || !Number.isInteger(rc[key])) {
      throw shapeError(`recordCounts.${key} must be an integer`)
    }
  }

  // Entity arrays present
  for (const key of ['commitments', 'payments', 'intentions', 'marketEntries'] as const) {
    if (!Array.isArray(parsed[key])) {
      throw shapeError(`${key} must be an array`)
    }
  }

  // Payments must have derived fields (STORAGE-FORMAT.md spec)
  const payments = parsed.payments as unknown[]
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i]
    if (!isObject(p)) {
      throw shapeError(`payments[${i}] is not an object`)
    }
    if (
      typeof p.principalPortion !== 'number' ||
      typeof p.interestPortion !== 'number' ||
      typeof p.balanceAfter !== 'number'
    ) {
      throw new SnapshotValidationError(
        'missing-derived-fields',
        `data.json is missing required derived fields on payments[${i}] ` +
          `(principalPortion / interestPortion / balanceAfter). Cancelling restore.`,
      )
    }
  }

  return parsed as unknown as Snapshot
}

/**
 * Validate a parsed snapshot's schemaVersion + recordCounts integrity.
 * Throws `SnapshotValidationError`.
 */
export function validateSnapshot(snap: Snapshot): void {
  if (snap.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SnapshotValidationError(
      'newer-version',
      `This data was written by a newer version of Personal Planner ` +
        `(schemaVersion ${snap.schemaVersion} > ${CURRENT_SCHEMA_VERSION}). ` +
        `Please update the app.`,
    )
  }
  // schemaVersion < current would trigger forward migrations — none yet at v1.

  const checks: Array<[keyof SnapshotCounts, number, number]> = [
    ['commitments', snap.recordCounts.commitments, snap.commitments.length],
    ['payments', snap.recordCounts.payments, snap.payments.length],
    ['intentions', snap.recordCounts.intentions, snap.intentions.length],
    ['marketEntries', snap.recordCounts.marketEntries, snap.marketEntries.length],
  ]
  for (const [key, expected, actual] of checks) {
    if (expected !== actual) {
      throw new SnapshotValidationError(
        'count-mismatch',
        `data.json is corrupt — recordCounts.${key} = ${expected} but array has ${actual} items. ` +
          `Cancelling restore.`,
      )
    }
  }
}

/** Return total entity-row count across all 4 tables. */
export function totalRecords(counts: SnapshotCounts): number {
  return counts.commitments + counts.payments + counts.intentions + counts.marketEntries
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function shapeError(detail: string): SnapshotValidationError {
  return new SnapshotValidationError(
    'wrong-shape',
    `data.json has an invalid shape (${detail}). Cancelling restore.`,
  )
}
