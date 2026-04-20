import { describe, it, expect } from 'vitest'
import {
  computeAmortization,
  monthlyPayment,
  splitPayment,
} from '../amortization'

describe('monthlyPayment', () => {
  it('computes a well-known 30-year mortgage payment', () => {
    // $200,000 @ 5% / 360 months → well-known answer ~ $1073.64
    const m = monthlyPayment(200000, 0.05, 360)
    expect(m).toBeCloseTo(1073.64, 1)
  })

  it('handles zero interest as simple division', () => {
    expect(monthlyPayment(12000, 0, 12)).toBe(1000)
  })

  it('returns 0 for non-positive principal', () => {
    expect(monthlyPayment(0, 0.05, 360)).toBe(0)
    expect(monthlyPayment(-1, 0.05, 360)).toBe(0)
  })
})

describe('computeAmortization', () => {
  it('produces a schedule whose final balance is exactly zero', () => {
    const rows = computeAmortization({
      principal: 200000,
      annualRate: 0.05,
      termMonths: 360,
      startDate: '2026-01-01',
    })
    expect(rows).toHaveLength(360)
    expect(rows[rows.length - 1]!.balance).toBe(0)
  })

  it('first row has most interest, last row has most principal', () => {
    const rows = computeAmortization({
      principal: 200000,
      annualRate: 0.05,
      termMonths: 360,
      startDate: '2026-01-01',
    })
    const first = rows[0]!
    const last = rows[rows.length - 1]!
    // Interest on month 1 of a $200k 5% loan ≈ $833.33
    expect(first.interest).toBeCloseTo(833.33, 1)
    expect(first.principal).toBeLessThan(first.interest)
    expect(last.principal).toBeGreaterThan(last.interest)
  })

  it('dates advance monthly from startDate', () => {
    const rows = computeAmortization({
      principal: 12000,
      annualRate: 0,
      termMonths: 12,
      startDate: '2026-01-15',
    })
    expect(rows[0]!.date).toBe('2026-01-15')
    expect(rows[1]!.date).toBe('2026-02-15')
    expect(rows[11]!.date).toBe('2026-12-15')
  })

  it('returns empty for invalid inputs', () => {
    expect(
      computeAmortization({
        principal: 0,
        annualRate: 0.05,
        termMonths: 360,
        startDate: '2026-01-01',
      }),
    ).toEqual([])
    expect(
      computeAmortization({
        principal: 1000,
        annualRate: 0.05,
        termMonths: 0,
        startDate: '2026-01-01',
      }),
    ).toEqual([])
  })
})

describe('splitPayment', () => {
  it('splits a scheduled payment at month 1 correctly', () => {
    // $200k @ 5%, prior balance = $200k → interest = 833.33
    const { principal, interest, balanceAfter } = splitPayment(
      1073.64,
      200000,
      0.05,
    )
    expect(interest).toBeCloseTo(833.33, 1)
    expect(principal).toBeCloseTo(240.31, 1)
    expect(balanceAfter).toBeCloseTo(199759.69, 1)
  })

  it('handles over-payment: all excess goes to principal, never negative balance', () => {
    const { principal, interest, balanceAfter } = splitPayment(
      100000,
      1000,
      0.05,
    )
    expect(interest).toBeCloseTo(4.17, 1) // 1000 * 0.05/12
    expect(principal).toBeGreaterThan(1000)
    expect(balanceAfter).toBe(0)
  })

  it('handles zero prior balance', () => {
    const { principal, interest, balanceAfter } = splitPayment(500, 0, 0.05)
    expect(interest).toBe(0)
    expect(principal).toBe(500)
    expect(balanceAfter).toBe(0)
  })
})
