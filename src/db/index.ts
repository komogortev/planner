import Dexie, { type Table } from 'dexie'
import type {
  Commitment,
  Intention,
  MarketEntry,
  Payment,
} from './schema'

/**
 * Personal-planner IndexedDB schema (Dexie).
 *
 * Version 1 — initial schema. Bump version + add upgrade() when shape changes.
 */
export class PlannerDb extends Dexie {
  commitments!: Table<Commitment, string>
  payments!: Table<Payment, string>
  intentions!: Table<Intention, string>
  marketEntries!: Table<MarketEntry, string>

  constructor() {
    super('personal-planner')
    this.version(1).stores({
      // Indices — first field is primary key, subsequent are secondary indices
      commitments: 'id, type, startDate, updatedAt',
      payments: 'id, commitmentId, date',
      intentions: 'id, status, category, updatedAt',
      marketEntries: 'id, intentionId, observedAt',
    })
  }
}

export const db = new PlannerDb()
