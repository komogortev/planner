/**
 * Dexie entity types for personal-planner.
 *
 * L0 entity domains:
 *   - Commitment + Payment (fixed obligations with actual payment history)
 *   - Intention (mid-horizon plan items with lifecycle)
 *   - MarketEntry (append-only price/availability log per intention)
 *
 * L2 organization layer (schema v3, 2026-04-28):
 *   - Category (single-pick controlled-vocabulary, foreign key on every domain entity)
 *   - Theme (cross-cutting many-to-many container with own status/target metadata)
 *   - ThemeMember (join table — themeId × entityType × entityId)
 *
 * Tags are stored denormalized as `tags: string[]` on each domain entity
 * (Dexie multi-entry index `*tags`).
 *
 * See `docs/L2-ORGANIZATION.md` for design rationale + migration plan.
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
  /** L2 — single-pick category foreign key. null = uncategorized. */
  categoryId: string | null
  /** L2 — free-form folksonomy tags. Always present, may be []. */
  tags: string[]
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
  targetBudget: number | null
  status: IntentionStatus
  notes: string
  /** L2 — single-pick category foreign key. Replaces v2's free-text `category`. */
  categoryId: string | null
  /** L2 — free-form folksonomy tags. Always present, may be []. */
  tags: string[]
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
  /** L2 — single-pick category foreign key. null = uncategorized (typical: inherits parent intention's category in display). */
  categoryId: string | null
  /** L2 — free-form folksonomy tags. Always present, may be []. */
  tags: string[]
  createdAt: string
}

/**
 * L2 — Category: single-pick controlled vocabulary, user-extensible.
 *
 * Built-ins seeded on v2→v3 upgrade with fixed ids (`cat-purchases`,
 * `cat-travel`, `cat-skill-development`, `cat-subscriptions`); user-added
 * categories get UUIDs.
 *
 * Deletion semantics (Q1 resolution): refused when in use. The Categories
 * admin shows the usage count and a reassign link rather than allowing
 * cascade-null or soft-archive. No `archived` flag in this MVP.
 */
export interface Category {
  id: string
  label: string
  /** Stable display order. Built-ins seeded with low values (0..3). */
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type ThemeStatus = 'active' | 'paused' | 'achieved' | 'cancelled'

/**
 * L2 — Theme: cross-cutting many-to-many container with own metadata.
 *
 * Pulls items together regardless of category or entity type via the
 * `themeMembers` join table. Used in S3 (not yet surfaced in UI in S1).
 */
export interface Theme {
  id: string
  label: string
  status: ThemeStatus
  /** Optional target date (YYYY-MM-DD) for progression rendering. */
  targetDate: string | null
  /** Optional target spend amount for progression rollup. */
  targetAmount: number | null
  notes: string
  createdAt: string
  updatedAt: string
}

/**
 * L2 — ThemeMember: links a Theme to a domain entity. Compound index on
 * `[themeId+entityType+entityId]` for de-duplication on attach and fast
 * member queries.
 */
export interface ThemeMember {
  id: string
  themeId: string
  entityType: 'commitment' | 'intention' | 'marketEntry'
  entityId: string
  /** ISO timestamp */
  addedAt: string
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
