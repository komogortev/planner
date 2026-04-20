/** Format a number as currency using the user's locale (defaults to USD). */
export function formatMoney(
  value: number | null | undefined,
  currency = 'USD',
): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Round to 2 decimal places, preserving sign. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
