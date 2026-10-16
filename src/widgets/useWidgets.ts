// The system widgets with their live activation (system.ts), and the toggle that writes it. A toggle is a record write
// like any other (writeRecords: row + outbox in one transaction), then a sync nudge.
import { computed } from 'vue'
import { db } from '@/db'
import { writeRecords } from '@/db/records'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { syncSoon } from '@/sync'
import { pendingJournal } from '@/harness/loop'
import { resolveSystemWidgets, SYSTEM_WIDGETS, systemWidgetRow, type HeldWidget, type SystemWidgetId } from './system'
import { projectWidgetId, projectWidgetRow, resolveProjectWidgets } from './projects'
import type { WidgetRecord } from '@/domain/records'

export function useWidgets() {
  // null until the first read: the defaults must not show (or be toggled from) before the stored rows are known.
  const rows = useLiveQuery<(HeldWidget & Partial<WidgetRecord>)[] | null>(() => db.widgets.toArray(), null)
  const loaded = computed(() => rows.value !== null)
  const widgets = computed(() => resolveSystemWidgets(rows.value ?? []))
  const isActive = (id: SystemWidgetId) => loaded.value && (widgets.value.find((w) => w.id === id)?.active ?? false)
  const projects = computed(() => resolveProjectWidgets(rows.value ?? []))
  // C4: every listed widget with its tint (null = default glass), for the cards and the menus' duplicate marking.
  const looks = computed(() => [
    ...widgets.value.map((w) => ({ id: w.id as string, name: w.name, tint: rowOf(w.id)?.appearance?.tint ?? null })),
    ...projects.value.map((p) => ({ id: p.id, name: rowOf(p.id)?.name ?? p.repo, tint: rowOf(p.id)?.appearance?.tint ?? null })),
  ])
  const rowOf = (id: string) => rows.value?.find((r) => r.id === id && !r.deletedAt)
  const tintOf = (id: string) => looks.value.find((l) => l.id === id)?.tint ?? null
  return { widgets, loaded, isActive, projects, looks, tintOf }
}

/**
 * Set a widget's tint (C4); null = the default glass. A system widget with no row yet gets one at its default switch
 * state; a project widget always has its row (it was switched on to exist).
 */
export async function setWidgetTint(id: string, tint: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString()
  const held = await db.widgets.get(id)
  const appearance = tint === null ? null : { tint }
  const sys = SYSTEM_WIDGETS.find((s) => s.id === id)
  let row: WidgetRecord
  // A widget that exists only with its record (Summary) is not created by a colour pick: its card can show for a pending
  // run on a device whose account doesn't list it, and a row would list it everywhere (needsRecord).
  if (sys?.needsRecord && (!held || held.deletedAt)) return { ok: false, error: 'This widget is not on your list.' }
  // Known limit (C4, accepted): rows are replaced whole, so a pick on a device that hasn't pulled a switch made elsewhere
  // writes this device's `active` back. The Worker keeps the conflict revision.
  if (sys) row = { ...systemWidgetRow(sys, held?.active ?? sys.defaultActive, now, held), appearance }
  else if (held?.kind === 'project' && held.project) row = { ...projectWidgetRow(held.project.repo, held.project.private, held.active, now, held), appearance }
  else return { ok: false, error: 'unknown widget' }
  const r = await writeRecords(db, [{ recordKind: 'widget', row: { ...row } }], now)
  if (!r.ok) return { ok: false, error: r.errors.join('; ') }
  syncSoon()
  return { ok: true }
}

/** Switch a repo's project widget on or off (G2). The first switch writes the row; off keeps it (never deleted). */
export async function setProjectActive(repo: string, isPrivate: boolean, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString()
  const held = await db.widgets.get(projectWidgetId(repo))
  const r = await writeRecords(db, [{ recordKind: 'widget', row: { ...projectWidgetRow(repo, isPrivate, active, now, held) } }], now)
  if (!r.ok) return { ok: false, error: r.errors.join('; ') }
  syncSoon()
  return { ok: true }
}

export async function setWidgetActive(id: SystemWidgetId, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = SYSTEM_WIDGETS.find((s) => s.id === id)
  if (!w) return { ok: false, error: 'unknown widget' }
  // Unmounting the Summary card aborts its model call's follow (RunStep); the reply would then wait unseen.
  if (id === 'system-summary' && !active && pendingJournal() !== null) return { ok: false, error: 'Summary has a run waiting. Finish or stop it first.' }
  const held = await db.widgets.get(id)
  const r = await writeRecords(db, [{ recordKind: 'widget', row: { ...systemWidgetRow(w, active, new Date().toISOString(), held) } }], new Date().toISOString())
  if (!r.ok) return { ok: false, error: r.errors.join('; ') }
  syncSoon()
  return { ok: true }
}
