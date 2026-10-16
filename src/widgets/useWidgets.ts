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
  return { widgets, loaded, isActive, projects }
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
