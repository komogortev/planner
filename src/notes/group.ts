// The Dashboard's temporary notes list (D-14a): newest first by capture time, one header per day in the device's time
// zone (D-23), rows = time + the first lines. Pure, so it can be tested without a browser; the notes widget keeps this sort.
import type { Entry } from '@/domain/entry'

export interface DayGroup {
  /** `YYYY-MM-DD` in the zone. */
  day: string
  label: string
  entries: Entry[]
}

const zoneOf = (zone?: string) => zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

/** The calendar day an instant falls on in `zone`. */
export function dayKey(iso: string, zone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zoneOf(zone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function dayLabel(day: string): string {
  // Noon UTC of that calendar day, shown in UTC, so the label never slides to a neighbouring day.
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`))
}

export function timeLabel(iso: string, zone?: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: zoneOf(zone), hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** Live entries only (a soft-deleted note is not listed), newest first, grouped by local day. */
export function groupByDay(entries: Entry[], zone?: string): DayGroup[] {
  const live = entries
    .filter((e) => !e.deletedAt)
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
  const groups: DayGroup[] = []
  for (const e of live) {
    const day = dayKey(e.createdAt, zone)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.entries.push(e)
    else groups.push({ day, label: dayLabel(day), entries: [e] })
  }
  return groups
}
