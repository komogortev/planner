/** Today's date as ISO YYYY-MM-DD (local time). */
export function todayISO(): string {
  const d = new Date()
  return toISODate(d)
}

/** Convert a Date to YYYY-MM-DD using local date parts. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Current ISO-8601 timestamp with timezone. */
export function nowISO(): string {
  return new Date().toISOString()
}

/** Format an ISO date/timestamp as "Mar 15, 2026". Empty string on falsy input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Short "Mar 15" format — omits year for compact UI. */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Advance a YYYY-MM-DD date by n months, preserving day-of-month where possible
 * (clamps to last day if target month is shorter).
 */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y!, m! - 1, 1)
  base.setMonth(base.getMonth() + n)
  const year = base.getFullYear()
  const month = base.getMonth()
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate()
  const day = Math.min(d!, lastDayOfMonth)
  return toISODate(new Date(year, month, day))
}
