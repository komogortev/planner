// The system widgets (D-107…D-110) and whether each is active on the Dashboard. Environment-free: no Dexie, Vue or DOM.
//
// Activation is per account (owner, 2026-10-13): it rides the existing `widget` record kind, one row per system widget
// under a fixed id, so every device converges on the same Dashboard. No row means the widget's default — a device never
// writes a row just to state a default, so two devices opening the app cannot race on rows nobody chose. The first
// toggle writes the row; after that the row's `active` wins on every device (last writer wins, like any record).
import type { WidgetRecord } from '@/domain/records'
import { keptAppearance } from './projects'


export interface SystemWidget {
  id: SystemWidgetId
  name: string
  description: string
  defaultActive: boolean
}

/** Dashboard order. Ids are fixed forever: they are the record ids every device shares. */
export const SYSTEM_WIDGETS: readonly SystemWidget[] = [
  { id: 'system-today', name: 'Today', description: "Today's open Tasks, overdue ones with their date. Done, moved and dropped ones leave the list.", defaultActive: true },
  { id: 'system-summary', name: 'Summary', description: 'Your day in four lists (done, moved, still open, dropped) and, on request, a short evening brief written by your model.', defaultActive: false },
  { id: 'system-notes', name: 'Notes', description: 'Everything you captured, newest first. The source archive behind your Tasks.', defaultActive: false },
]

export type SystemWidgetId = 'system-today' | 'system-summary' | 'system-notes'

/** A widget row as the device holds it (`deletedAt` included, sync fields ignored). */
export type HeldWidget = Pick<WidgetRecord, 'id' | 'active'> & { deletedAt?: string | null }

/** Each system widget with its resolved state: a live row's `active`, else the default. Rows for other ids are ignored.
 *  Summary v3 is listed for every account (D-122 Q3, R3); until then it was listed only where its record existed (G2). */
export function resolveSystemWidgets(rows: readonly HeldWidget[]): (SystemWidget & { active: boolean })[] {
  const live = new Map(rows.filter((r) => !r.deletedAt).map((r) => [r.id, r.active]))
  return SYSTEM_WIDGETS.map((w) => ({ ...w, active: live.get(w.id) ?? w.defaultActive }))
}

/** The row a toggle writes. `held` keeps the first creation time, so a second toggle is an edit, not a new widget. */
export function systemWidgetRow(w: SystemWidget, active: boolean, now: string, held?: Pick<WidgetRecord, 'createdAt' | 'appearance'> | null): WidgetRecord {
  return { id: w.id, name: w.name, kind: 'system', active, lens: null, lineage: null, ...keptAppearance(held), createdAt: held?.createdAt ?? now, updatedAt: now }
}
