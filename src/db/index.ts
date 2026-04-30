import Dexie, { type Table } from 'dexie'
import type {
  AppSettings,
  Category,
  Commitment,
  Intention,
  MarketEntry,
  Payment,
  Theme,
  ThemeMember,
} from './schema'
import { BUILT_IN_CATEGORIES, USER_CATEGORY_SORT_ORDER } from './categorySeed'
import {
  backfillCommitmentRow,
  backfillMarketEntryRow,
  migrateIntentionRow,
  type IntentionV1,
} from './migrations'
import { uuid } from '@/utils/uuid'
import { nowISO } from '@/utils/dates'

/**
 * Personal-planner IndexedDB schema (Dexie).
 *
 * Version 1 — initial schema.
 * Version 2 — added `settings` singleton table for L1 GitHub sync (2026-04-26).
 * Version 3 — L2 organization layer (2026-04-28):
 *               - new tables: `categories`, `themes`, `themeMembers`
 *               - new fields on entity tables: `categoryId`, `tags` (multi-entry index)
 *               - `intentions.category` free-text → `categoryId` foreign key
 *
 * Once shipped, a version is FROZEN. Schema changes go via a NEW version+upgrade.
 */
export class PlannerDb extends Dexie {
  commitments!: Table<Commitment, string>
  payments!: Table<Payment, string>
  intentions!: Table<Intention, string>
  marketEntries!: Table<MarketEntry, string>
  settings!: Table<AppSettings, string>
  categories!: Table<Category, string>
  themes!: Table<Theme, string>
  themeMembers!: Table<ThemeMember, string>

  constructor() {
    super('personal-planner')
    this.version(1).stores({
      // Indices — first field is primary key, subsequent are secondary indices
      commitments: 'id, type, startDate, updatedAt',
      payments: 'id, commitmentId, date',
      intentions: 'id, status, category, updatedAt',
      marketEntries: 'id, intentionId, observedAt',
    })

    // v2 — add settings singleton table for L1 GitHub sync.
    // No upgrade callback needed: absence of the row means "not connected".
    // Existing v1 data is untouched.
    this.version(2).stores({
      commitments: 'id, type, startDate, updatedAt',
      payments: 'id, commitmentId, date',
      intentions: 'id, status, category, updatedAt',
      marketEntries: 'id, intentionId, observedAt',
      settings: 'id',
    })

    // v3 — L2 organization layer.
    //   - drops `intentions.category` secondary index (the field is renamed/dropped per row in upgrade)
    //   - adds `categoryId` index on entity tables for "filter by category" list views
    //   - adds `*tags` multi-entry index on entity tables for "filter by tag"
    //   - adds 3 new tables: `categories`, `themes`, `themeMembers`
    this.version(3)
      .stores({
        commitments: 'id, type, startDate, updatedAt, categoryId, *tags',
        payments: 'id, commitmentId, date',
        intentions: 'id, status, updatedAt, categoryId, *tags',
        marketEntries: 'id, intentionId, observedAt, categoryId, *tags',
        settings: 'id',
        categories: 'id, label, sortOrder',
        themes: 'id, label, status, targetDate, updatedAt',
        themeMembers: 'id, themeId, entityId, [themeId+entityType+entityId]',
      })
      .upgrade(async (trans) => {
        const now = nowISO()
        // Locally-scoped to the upgrade run so re-init in tests doesn't leak state.
        const pendingNewCategories: Category[] = []

        // 1. Seed built-in categories.
        await trans.table<Category>('categories').bulkAdd(
          BUILT_IN_CATEGORIES.map((seed) => ({
            id: seed.id,
            label: seed.label,
            sortOrder: seed.sortOrder,
            createdAt: now,
            updatedAt: now,
          })),
        )

        // 2. Migrate intentions: free-text `category` → `categoryId`. Newly created
        //    user categories are staged into `pendingNewCategories` and bulkAdded
        //    after iteration (we cannot write to another table from within a
        //    `.modify()` callback in Dexie). `.modify` mutates rows in place
        //    inside the upgrade transaction.
        //
        //    Dedupe by lowercased label so 5 intentions tagged "home" produce
        //    ONE category, not 5. (Bug fix 2026-04-29 — earlier devices that
        //    ran the v3 upgrade before this fix have stale dupes; cleaned up
        //    on app boot via `dedupeCategoriesInDb`.)
        const seenUserCategories = new Map<string, string>()
        await trans
          .table<IntentionV1>('intentions')
          .toCollection()
          .modify((row) => {
            const migrated = migrateIntentionRow(row, {
              builtIns: BUILT_IN_CATEGORIES,
              createUserCategory: (label) => {
                const key = label.toLowerCase()
                const existing = seenUserCategories.get(key)
                if (existing) return existing
                const id = uuid()
                seenUserCategories.set(key, id)
                pendingNewCategories.push({
                  id,
                  label,
                  sortOrder: USER_CATEGORY_SORT_ORDER,
                  createdAt: now,
                  updatedAt: now,
                })
                return id
              },
            })
            // Per-row audit trail (Q4 resolution) — safe to console.info from upgrade.
            // eslint-disable-next-line no-console
            console.info(
              `[planner v3 upgrade] intention "${row.label}" category="${row.category ?? ''}" → categoryId=${migrated.categoryId}`,
            )
            // Apply mutations onto the row Dexie is persisting.
            ;(row as Partial<Intention>).categoryId = migrated.categoryId
            ;(row as Partial<Intention>).tags = []
            // Drop the v2 free-text field.
            delete (row as { category?: unknown }).category
          })
        if (pendingNewCategories.length > 0) {
          await trans.table<Category>('categories').bulkAdd(pendingNewCategories)
        }

        // 3. Backfill commitments.
        await trans
          .table<Commitment>('commitments')
          .toCollection()
          .modify((row) => {
            const back = backfillCommitmentRow(row)
            row.categoryId = back.categoryId
            row.tags = back.tags
          })

        // 4. Backfill marketEntries.
        await trans
          .table<MarketEntry>('marketEntries')
          .toCollection()
          .modify((row) => {
            const back = backfillMarketEntryRow(row)
            row.categoryId = back.categoryId
            row.tags = back.tags
          })

        // themes / themeMembers tables come online empty — populated when S3 ships.
      })

    // ---------------------------------------------------------------------
    // Migration template — DO NOT REMOVE
    // ---------------------------------------------------------------------
    // Once shipped, a version() block is FROZEN. To change schema (add/remove
    // indices, rename fields, split tables), bump the version and provide a
    // new .upgrade() callback. Dexie applies upgrades in order for users who
    // installed earlier versions.
    //
    // Rules:
    //   - Never edit a shipped version() — only add new versions.
    //   - Test upgrades against a real DB populated at the prior version.
    //   - Tables not listed in a new version() call inherit the prior schema.
    //   - Set a store to `null` to drop it (rare; data loss).
  }
}

export const db = new PlannerDb()
