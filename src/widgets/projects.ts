// Project widgets (docs/GITHUB-BRIDGE.md §5, G2). Environment-free: no Dexie, Vue or DOM.
//
// A project widget is a `widget` record of kind `project` naming one GitHub repo. Its id is derived from the repo, so two
// devices switching on the same repo write the same row. A project is switched off by `active: false`, never deleted: the
// server keeps a deleted record deleted (records.ts `decide`), so a deleted id could never be switched back on.
// How the card looks is the repo's own `.planner.json` (§5, amendment 2026-10-16), read by the Worker, not stored here.
import { uuid5 } from '../domain/uuid5'
import type { WidgetRecord } from '../domain/records'

export interface ProjectWidget {
  id: string
  repo: string
  private: boolean
  active: boolean
}

/** The record id of a repo's project widget. GitHub names are case-insensitive, so the id is too. */
export const projectWidgetId = (repo: string): string => uuid5(`project-widget|${repo.toLowerCase()}`)

/** The live project widgets among the rows a device holds, in repo-name order. */
export function resolveProjectWidgets(rows: readonly (Partial<WidgetRecord> & { id: string; deletedAt?: string | null })[]): ProjectWidget[] {
  return rows
    .filter((r) => !r.deletedAt && r.kind === 'project' && r.project)
    .map((r) => ({ id: r.id, repo: r.project!.repo, private: r.project!.private, active: r.active === true }))
    .sort((a, b) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase()))
}

/**
 * A held row's appearance for a rewrite of it (C4). Left out when this device doesn't hold one: the key is then absent,
 * and the Worker keeps the stored tint (ADDED_FIELDS) instead of a stale device writing "no tint" over it.
 */
export function keptAppearance(held?: Pick<WidgetRecord, 'appearance'> | null): Pick<WidgetRecord, 'appearance'> {
  return held && held.appearance !== undefined ? { appearance: held.appearance } : {}
}

/**
 * The row a switch writes. `held` keeps the first creation time, so switching again is an edit, not a new widget, and its
 * appearance (C4, `keptAppearance`).
 */
export function projectWidgetRow(repo: string, isPrivate: boolean, active: boolean, now: string, held?: Pick<WidgetRecord, 'createdAt' | 'appearance'> | null): WidgetRecord {
  const name = repo.slice(repo.indexOf('/') + 1).slice(0, 80)
  return {
    id: projectWidgetId(repo), name, kind: 'project', active, lens: null, lineage: null,
    project: { repo, private: isPrivate }, ...keptAppearance(held), createdAt: held?.createdAt ?? now, updatedAt: now,
  }
}
