/**
 * Shared L2 schema migration — Dexie v2→v3 upgrade AND snapshot v1→v2 forward
 * migration use the same per-row transformation code, so the same input data
 * yields the same output regardless of which path runs first.
 *
 * The two callers wire this differently:
 *   - Dexie upgrade: calls `transformIntentionRow` etc. inside `.modify()` and
 *     uses `pushNewCategory` to add to the `categories` table on the fly.
 *   - Snapshot Restore: pre-builds new categories into a list, runs all row
 *     transforms, returns a new SnapshotV2 object.
 *
 * No Dexie / fetch dependencies in this module — pure functions only, easy
 * to unit test against fixtures.
 */

import {
  BUILT_IN_CATEGORIES,
  USER_CATEGORY_SORT_ORDER,
  type BuiltInCategorySeed,
} from './categorySeed'
import type { Category } from './schema'
import { uuid } from '@/utils/uuid'

// ----------------------------------------------------------------------------
// V1 (pre-L2) row shapes — the bare minimum we need to read.
// V2 (post-L2) shapes are the same types as the live `schema.ts` exports for
// Commitment / Intention / MarketEntry / Category, so we don't redeclare them.
// ----------------------------------------------------------------------------

export interface CommitmentV1 {
  id: string
  type: string
  label: string
  startDate: string
  principal: number
  annualRate: number
  termMonths: number
  paymentDay: number
  notes: string
  createdAt: string
  updatedAt: string
}

export interface IntentionV1 {
  id: string
  label: string
  /** Free-text category — dropped in v2 (mapped to categoryId). */
  category: string
  targetBudget: number | null
  status: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface MarketEntryV1 {
  id: string
  intentionId: string
  observedAt: string
  pricePoint: number
  source: string
  availability: string | null
  notes: string
  createdAt: string
}

// ----------------------------------------------------------------------------
// Per-row helpers — used by both Dexie upgrade and snapshot migration.
// ----------------------------------------------------------------------------

/** Add `categoryId: null` and `tags: []` to a commitment-shaped row. */
export function backfillCommitmentRow<T extends CommitmentV1>(row: T): T & {
  categoryId: string | null
  tags: string[]
} {
  return {
    ...row,
    categoryId: null,
    tags: [],
  }
}

/** Add `categoryId: null` and `tags: []` to a market-entry-shaped row. */
export function backfillMarketEntryRow<T extends MarketEntryV1>(row: T): T & {
  categoryId: string | null
  tags: string[]
} {
  return {
    ...row,
    categoryId: null,
    tags: [],
  }
}

/**
 * Map an intention v1 free-text `category` → categoryId.
 *
 * Strategy:
 *   - empty / whitespace-only → null
 *   - case-insensitive match against built-in labels → built-in id
 *   - otherwise → newly created user category (via `createUserCategory`)
 *
 * The `createUserCategory` callback lets the caller register the new category
 * in its target storage (Dexie tx or accumulated list) and return its id.
 *
 * Returns the v2 intention row (with `categoryId` + `tags` added, `category`
 * removed) and the resolved categoryId.
 */
export function migrateIntentionRow(
  row: IntentionV1,
  ctx: {
    builtIns: readonly BuiltInCategorySeed[]
    /** Called when a free-text value doesn't match any built-in. Returns the new category's id. */
    createUserCategory: (label: string) => string
  },
): {
  // Same shape as live Intention but typed loosely so this module doesn't
  // import from schema.ts in a circular way.
  id: string
  label: string
  targetBudget: number | null
  status: string
  notes: string
  categoryId: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
} {
  const free = (row.category ?? '').trim()
  let categoryId: string | null = null
  if (free !== '') {
    const lower = free.toLowerCase()
    const builtin = ctx.builtIns.find((c) => c.label.toLowerCase() === lower)
    if (builtin) {
      categoryId = builtin.id
    } else {
      categoryId = ctx.createUserCategory(free)
    }
  }
  return {
    id: row.id,
    label: row.label,
    targetBudget: row.targetBudget,
    status: row.status,
    notes: row.notes,
    categoryId,
    tags: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ----------------------------------------------------------------------------
// Snapshot v1 → v2 — used by `parseSnapshot` on Restore.
// ----------------------------------------------------------------------------

/**
 * Loose v1 snapshot shape — only the fields we actually transform. Other
 * fields (schemaVersion, appVersion, exportedAt, deviceId, recordCounts) are
 * forwarded by `migrateSnapshotV1ToV2`.
 */
export interface SnapshotV1Loose {
  schemaVersion: 1
  appVersion: string
  exportedAt: string
  deviceId: string
  recordCounts: {
    commitments: number
    payments: number
    intentions: number
    marketEntries: number
  }
  commitments: CommitmentV1[]
  payments: unknown[]
  intentions: IntentionV1[]
  marketEntries: MarketEntryV1[]
}

/** Result shape of the snapshot migration — extends with new entity arrays. */
export interface SnapshotV2Migrated {
  schemaVersion: 2
  appVersion: string
  exportedAt: string
  deviceId: string
  recordCounts: {
    commitments: number
    payments: number
    intentions: number
    marketEntries: number
    categories: number
    themes: number
    themeMembers: number
  }
  commitments: ReturnType<typeof backfillCommitmentRow>[]
  payments: unknown[]
  intentions: ReturnType<typeof migrateIntentionRow>[]
  marketEntries: ReturnType<typeof backfillMarketEntryRow>[]
  categories: Category[]
  themes: never[]
  themeMembers: never[]
}

/**
 * Transform a v1 snapshot (read from `data.json` on Restore) into a v2 shape.
 *
 * Produces newly-seeded built-in categories AND any user-categories created
 * for unmatched intention free-text. Output recordCounts reflect the new
 * entity counts. Themes / themeMembers arrays are empty — those tables come
 * online with S3.
 */
export function migrateSnapshotV1ToV2(
  v1: SnapshotV1Loose,
  now: () => string = () => new Date().toISOString(),
): SnapshotV2Migrated {
  const nowTs = now()

  // 1. Seed built-in categories.
  const categories: Category[] = BUILT_IN_CATEGORIES.map((seed) => ({
    id: seed.id,
    label: seed.label,
    sortOrder: seed.sortOrder,
    createdAt: nowTs,
    updatedAt: nowTs,
  }))

  // 2. Map free-text → categoryId for intentions, accumulating new user categories.
  //    Dedupe by lowercased label so multiple v1 intentions tagged "home" / "Home"
  //    collapse into ONE user category, not N copies. (Bug fix 2026-04-29.)
  const seenUserCategories = new Map<string, string>()
  const intentions = v1.intentions.map((row) =>
    migrateIntentionRow(row, {
      builtIns: BUILT_IN_CATEGORIES,
      createUserCategory: (label) => {
        const key = label.toLowerCase()
        const existing = seenUserCategories.get(key)
        if (existing) return existing
        const id = uuid()
        seenUserCategories.set(key, id)
        categories.push({
          id,
          label,
          sortOrder: USER_CATEGORY_SORT_ORDER,
          createdAt: nowTs,
          updatedAt: nowTs,
        })
        return id
      },
    }),
  )

  // 3. Backfill remaining entity types.
  const commitments = v1.commitments.map(backfillCommitmentRow)
  const marketEntries = v1.marketEntries.map(backfillMarketEntryRow)

  return {
    schemaVersion: 2,
    appVersion: v1.appVersion,
    exportedAt: v1.exportedAt,
    deviceId: v1.deviceId,
    recordCounts: {
      commitments: commitments.length,
      payments: v1.payments.length,
      intentions: intentions.length,
      marketEntries: marketEntries.length,
      categories: categories.length,
      themes: 0,
      themeMembers: 0,
    },
    commitments,
    payments: v1.payments,
    intentions,
    marketEntries,
    categories,
    themes: [],
    themeMembers: [],
  }
}
