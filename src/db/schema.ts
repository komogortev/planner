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
