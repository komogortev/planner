/**
 * On-disk snapshot contract for L1 GitHub sync.
 *
 * Pure module — no Dexie writes; reads only via `buildSnapshot` from `db`.
 * Build / parse / validate the `data.json` shape defined in
 * `docs/STORAGE-FORMAT.md`. Easy to unit-test.
 *
 * v2 (2026-04-28) extends v1 with the L2 organization layer:
 *   - new top-level entity arrays: `categories`, `themes`, `themeMembers`
 *   - extended `recordCounts` with the 3 new entity counts
 *   - entity rows (commitment / intention / marketEntry) carry `categoryId` + `tags`
 *   - `intention.category` free-text is REMOVED (mapped to `categoryId` on migration)
 *
 * Forward migration: a v1 snapshot fetched on Restore is transformed via
 * `migrateSnapshotV1ToV2` (shared with the Dexie v2→v3 upgrade) before
 * validation + apply.
 *
 * Failure modes surface as `SnapshotValidationError` with user-facing copy.
 */

import { db } from './index'
import type {
  Category,
  Commitment,
  Intention,
  MarketEntry,
  Payment,
  Theme,
  ThemeMember,
} from './schema'
import {
  migrateSnapshotV1ToV2,
  type SnapshotV1Loose,
} from './migrations'

export const CURRENT_SCHEMA_VERSION = 2

export interface SnapshotCounts {
  commitments: number
  payments: number
  intentions: number
  marketEntries: number
  categories: number
  themes: number
  themeMembers: number
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
  categories: Category[]
  themes: Theme[]
  themeMembers: ThemeMember[]
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
 * Parse raw JSON text into a v2 Snapshot. v1 input is forward-migrated via
 * `migrateSnapshotV1ToV2` (same code path as the Dexie v2→v3 upgrade).
 *
 * Validates the top-level shape and the presence of required payment-derived
 * fields. Does NOT validate per-entity field types beyond what's needed for
 * safe handling — entity rows are trusted (Q2 resolution: do not recompute
 * derived fields).
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

  // v1 → forward-migrate. After this branch, `parsed` is a v2-shaped object.
  if (parsed.schemaVersion === 1) {
    parsed = migrateSnapshotV1ToV2(parsed as unknown as SnapshotV1Loose)
  }

  // recordCounts shape — v2 keys (entity arrays present below validate against this).
  const rc = (parsed as Record<string, unknown>).recordCounts
  if (!isObject(rc)) {
    throw shapeError('recordCounts must be an object')
  }
  for (const key of [
    'commitments',
    'payments',
    'intentions',
    'marketEntries',
    'categories',
    'themes',
    'themeMembers',
  ] as const) {
    if (typeof rc[key] !== 'number' || !Number.isInteger(rc[key])) {
      throw shapeError(`recordCounts.${key} must be an integer`)
    }
  }

  // Entity arrays present
  const obj = parsed as Record<string, unknown>
  for (const key of [
    'commitments',
    'payments',
    'intentions',
    'marketEntries',
    'categories',
    'themes',
    'themeMembers',
  ] as const) {
    if (!Array.isArray(obj[key])) {
      throw shapeError(`${key} must be an array`)
    }
  }

  // Payments must have derived fields (STORAGE-FORMAT.md spec).
  const payments = obj.payments as unknown[]
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
  // schemaVersion < current would have already been forward-migrated by parseSnapshot.

  const checks: Array<[keyof SnapshotCounts, number, number]> = [
    ['commitments', snap.recordCounts.commitments, snap.commitments.length],
    ['payments', snap.recordCounts.payments, snap.payments.length],
    ['intentions', snap.recordCounts.intentions, snap.intentions.length],
    ['marketEntries', snap.recordCounts.marketEntries, snap.marketEntries.length],
    ['categories', snap.recordCounts.categories, snap.categories.length],
    ['themes', snap.recordCounts.themes, snap.themes.length],
    ['themeMembers', snap.recordCounts.themeMembers, snap.themeMembers.length],
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

/** Return total entity-row count across all 7 tables. */
export function totalRecords(counts: SnapshotCounts): number {
  return (
    counts.commitments +
    counts.payments +
    counts.intentions +
    counts.marketEntries +
    counts.categories +
    counts.themes +
    counts.themeMembers
  )
}

/**
 * Read all 7 entity tables and assemble an in-memory `Snapshot` ready for sync.
 * `exportedAt` is set to "now". Caller passes `deviceId` (from settings) and
 * `appVersion` (from package.json — diagnostic field, not validated).
 */
export async function buildSnapshot(
  deviceId: string,
  appVersion: string,
): Promise<Snapshot> {
  const [
    commitments,
    payments,
    intentions,
    marketEntries,
    categories,
    themes,
    themeMembers,
  ] = await Promise.all([
    db.commitments.toArray(),
    db.payments.toArray(),
    db.intentions.toArray(),
    db.marketEntries.toArray(),
    db.categories.toArray(),
    db.themes.toArray(),
    db.themeMembers.toArray(),
  ])
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    deviceId,
    recordCounts: {
      commitments: commitments.length,
      payments: payments.length,
      intentions: intentions.length,
      marketEntries: marketEntries.length,
      categories: categories.length,
      themes: themes.length,
      themeMembers: themeMembers.length,
    },
    commitments,
    payments,
    intentions,
    marketEntries,
    categories,
    themes,
    themeMembers,
  }
}

/**
 * Pretty-print a snapshot as 2-space-indented JSON per `STORAGE-FORMAT.md`.
 * Round-trip property: `parseSnapshot(serializeSnapshot(s))` deeply equals `s`.
 */
export function serializeSnapshot(snap: Snapshot): string {
  return JSON.stringify(snap, null, 2)
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
