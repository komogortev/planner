/**
 * Dexie entity types for personal-planner.
 *
 * Three independent entity domains at L0:
 *   - Commitment + Payment (fixed obligations with actual payment history)
 *   - Intention (mid-horizon plan items with lifecycle)
 *   - MarketEntry (append-only price/availability log per intention)
 */

export type CommitmentType = 'mortgage' | 'loan' | 'subscription' | 'other'

export interface Commitment {
  id: string
  type: CommitmentType
  label: string
  /** ISO date string (YYYY-MM-DD) */
  startDate: string
  /** Initial principal amount. */
  principal: number
  /** Annual interest rate as a decimal, e.g. 0.045 = 4.5%. */
  annualRate: number
  /** Term in months. */
  termMonths: number
  /** Day of month payment is due (1–31). */
  paymentDay: number
  notes: string
  /** ISO timestamp */
  createdAt: string
  /** ISO timestamp */
  updatedAt: string
}

export interface Payment {
  id: string
  commitmentId: string
  /** ISO date string (YYYY-MM-DD) */
  date: string
  amount: number
  /** Derived on save from amortization math + prior balance. */
  principalPortion: number
  interestPortion: number
  /** Remaining balance after this payment. */
  balanceAfter: number
  notes: string
  createdAt: string
}

export type IntentionStatus =
  | 'considering'
  | 'researching'
  | 'committed'
  | 'acquired'
  | 'dropped'

export interface Intention {
  id: string
  label: string
  category: string
  targetBudget: number | null
  status: IntentionStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export type MarketAvailability = 'in-stock' | 'limited' | 'unavailable' | null

export interface MarketEntry {
  id: string
  intentionId: string
  /** ISO date string (YYYY-MM-DD) */
  observedAt: string
  pricePoint: number
  source: string
  availability: MarketAvailability
  notes: string
  createdAt: string
}

/**
 * Singleton app settings. Stores the GitHub sync connection (L1).
 *
 * Stored in the `settings` Dexie table with `id: 'singleton'` — there is only
 * ever one row. Absence of the row means "not connected".
 *
 * `pat` is a fine-grained GitHub Personal Access Token scoped to a single
 * private repo with `Contents: read+write`. See `docs/L1-GITHUB.md`.
 */
export interface AppSettings {
  /** Always 'singleton' — primary key constraint enforces a single row. */
  id: 'singleton'
  /** github_pat_… fine-grained token. */
  pat: string
  /** GitHub owner login of the data repo. */
  owner: string
  /** Name of the private data repo. */
  repo: string
  /** Captured from `GET /user .login` at Connect time — receipt that the PAT works. */
  githubLogin: string
  /** `${platform}-${YYYY-MM-DD}` of first Connect; used in commit messages + snapshot. */
  deviceId: string
  /** sha of data.json from the last successful sync. null until first sync. */
  lastKnownSha: string | null
  /** ISO timestamp of last successful sync. null until first sync. */
  lastSyncedAt: string | null
}
