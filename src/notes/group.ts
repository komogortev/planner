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

/** A note the owner removed (dropped as junk, or closed by the v1 loop) — any state but open. */
export function isRemoved(states: ReadonlyMap<string, { state: string }>, id: string): boolean {
  return (states.get(id)?.state ?? 'open') !== 'open'
}

/** Live entries split into the list the owner reads and the ones he removed (calibration 2026-10-12: removed notes stay
 *  out of the list, behind their own line). Order is kept. `pinned` keeps a note in the list it was in when the owner
 *  just dropped or restored it, so the rows do not move under a second tap. */
export function splitRemoved<T extends { id: string }>(
  entries: T[],
  states: ReadonlyMap<string, { state: string }>,
  pinned: ReadonlyMap<string, 'kept' | 'removed'> = new Map(),
): { kept: T[]; removed: T[] } {
  const kept: T[] = []
  const removed: T[] = []
  for (const e of entries) ((pinned.get(e.id) ?? (isRemoved(states, e.id) ? 'removed' : 'kept')) === 'removed' ? removed : kept).push(e)
  return { kept, removed }
}

/** The brief view's line: the newest kept note's first line, and how many were captured today (in `zone`). */
export function notesBrief(kept: Entry[], now: string, zone?: string): { latest: string | null; today: number } {
  const live = kept.filter((e) => !e.deletedAt)
  const newest = live.reduce<Entry | null>((a, e) => (!a || e.createdAt > a.createdAt ? e : a), null)
  const day = dayKey(now, zone)
  return {
    latest: newest?.body.split('\n').find((l) => l.trim() !== '')?.trim() ?? null,
    today: live.filter((e) => dayKey(e.createdAt, zone) === day).length,
  }
}
