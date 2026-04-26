import Dexie, { type Table } from 'dexie'
import type {
  AppSettings,
  Commitment,
  Intention,
  MarketEntry,
  Payment,
} from './schema'

/**
 * Personal-planner IndexedDB schema (Dexie).
 *
 * Version 1 — initial schema. Bump version + add upgrade() when shape changes.
 * Version 2 — added `settings` singleton table for L1 GitHub sync (2026-04-26).
 */
export class PlannerDb extends Dexie {
  commitments!: Table<Commitment, string>
  payments!: Table<Payment, string>
  intentions!: Table<Intention, string>
  marketEntries!: Table<MarketEntry, string>
  settings!: Table<AppSettings, string>

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

    // ---------------------------------------------------------------------
    // Migration template — DO NOT REMOVE
    // ---------------------------------------------------------------------
    // version(1) is FROZEN once the app has shipped. To change schema
    // (add/remove indices, rename fields, split tables), bump the version
    // and provide an .upgrade() callback. Dexie applies upgrades in order
    // for users who installed earlier versions.
    //
    // Example — add `priority` index to intentions and backfill default:
    //
    //   this.version(2)
    //     .stores({
    //       commitments: 'id, type, startDate, updatedAt',
    //       payments: 'id, commitmentId, date',
    //       intentions: 'id, status, category, priority, updatedAt',
    //       marketEntries: 'id, intentionId, observedAt',
    //     })
    //     .upgrade(async (trans) => {
    //       await trans.table('intentions').toCollection().modify((row) => {
    //         if (row.priority === undefined) row.priority = 'normal'
    //       })
    //     })
    //
    // Rules:
    //   - Never edit version(1) after shipping — only add new versions.
    //   - Test upgrades against a real DB populated at version(1).
    //   - Tables not listed in a new version() call inherit the prior schema.
    //   - Set a store to `null` to drop it (rare; data loss).
  }
}

export const db = new PlannerDb()
