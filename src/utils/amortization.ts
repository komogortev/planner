import { addMonths } from './dates'
import { round2 } from './money'

/**
 * One row of an amortization schedule.
 */
export interface AmortizationRow {
  /** 1-based payment number. */
  index: number
  /** Scheduled payment date (YYYY-MM-DD). */
  date: string
  /** Total scheduled payment amount. */
  payment: number
  /** Portion of this payment applied to principal. */
  principal: number
  /** Portion of this payment applied to interest. */
  interest: number
  /** Remaining balance after this payment. */
  balance: number
}

export interface AmortizationInput {
  principal: number
  /** Annual interest rate as decimal (0.045 for 4.5%). */
  annualRate: number
  termMonths: number
  /** First payment date (YYYY-MM-DD). */
  startDate: string
}

/**
 * Compute the standard fixed-rate amortization schedule for a term loan.
 *
 * Uses the classic formula:
 *   M = P * (r(1+r)^n) / ((1+r)^n - 1)
 * where r = monthlyRate, n = termMonths.
 *
 * The final row is balance-corrected so the remaining principal rounds to 0.
 */
export function computeAmortization(input: AmortizationInput): AmortizationRow[] {
  const { principal, annualRate, termMonths, startDate } = input

  if (!Number.isFinite(principal) || principal <= 0) return []
  if (!Number.isFinite(annualRate) || annualRate < 0) return []
  if (!Number.isInteger(termMonths) || termMonths <= 0) return []

  const monthlyRate = annualRate / 12
  const payment =
    monthlyRate === 0
      ? principal / termMonths
      : (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
        (Math.pow(1 + monthlyRate, termMonths) - 1)

  const rows: AmortizationRow[] = []
  let balance = principal

  for (let i = 1; i <= termMonths; i++) {
    const interest = monthlyRate === 0 ? 0 : balance * monthlyRate
    let principalPortion = payment - interest
    // Last row: absorb any rounding drift into the principal so balance lands on 0.
    if (i === termMonths) {
      principalPortion = balance
    }
    balance -= principalPortion
    rows.push({
      index: i,
      date: addMonths(startDate, i - 1),
      payment: round2(i === termMonths ? principalPortion + interest : payment),
      principal: round2(principalPortion),
      interest: round2(interest),
      balance: round2(Math.max(0, balance)),
    })
  }

  return rows
}

/**
 * Compute the monthly payment amount only (no schedule generation).
 */
export function monthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number,
): number {
  if (principal <= 0 || termMonths <= 0) return 0
  const r = annualRate / 12
  if (r === 0) return round2(principal / termMonths)
  return round2(
    (principal * (r * Math.pow(1 + r, termMonths))) /
      (Math.pow(1 + r, termMonths) - 1),
  )
}

/**
 * Split a single payment into principal/interest/new-balance given the prior balance.
 * Used for recording actual payments which may vary from scheduled amount.
 */
export function splitPayment(
  amount: number,
  priorBalance: number,
  annualRate: number,
): { principal: number; interest: number; balanceAfter: number } {
  const monthlyRate = annualRate / 12
  const interest = round2(Math.max(0, priorBalance * monthlyRate))
  const principal = round2(Math.max(0, amount - interest))
  const balanceAfter = round2(Math.max(0, priorBalance - principal))
  return { principal, interest, balanceAfter }
}
