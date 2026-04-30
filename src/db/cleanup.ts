/**
 * One-shot data cleanup routines for the personal-planner Dexie store.
 *
 * Background — duplicate categories bug (2026-04-29):
 *   The original v2→v3 upgrade in `db/index.ts` and the snapshot v1→v2
 *   migration in `migrations.ts` both called `createUserCategory(label)` once
 *   per v1 intention row, without deduping by lowercased label. That meant 5
 *   intentions tagged free-text `category: "home"` produced 5 separate `home`
 *   rows in the new categories table. The migrations have since been fixed,
 *   but devices that already ran the buggy upgrade carry stale dupes.
 *
 *   `dedupeCategoriesInDb` is the cleanup pass for those devices. It is
 *   idempotent — when no duplicates exist (typical after first run, or a
 *   fresh install) it short-circuits and does no writes.
 *
 *   The routine runs on every app boot from `main.ts`, so the next sync push
 *   from the cleaned device propagates the deduped snapshot to remote, and
 *   pulling devices get clean data.
 */

import { db } from './index'
import { nowISO } from '@/utils/dates'
import type { Category } from './schema'

export interface DedupeCategoriesResult {
  /** How many distinct (case-insensitive) labels had >1 row prior to merge. */
  mergedGroups: number
  /** Total non-canonical category rows deleted. */
  removedRows: number
  /** The labels that were merged — used for the banner copy. */
  mergedLabels: string[]
}

/** Built-ins are pinned by their `cat-` prefix so we keep them as canonical. */
function isBuiltInId(id: string): boolean {
  return id.startsWith('cat-')
}

/**
 * Pick the canonical row to keep when N rows share a lowercased label.
 *
 * Preference order:
 *   1. Built-in (id starts with `cat-`) — never delete a built-in.
 *   2. Lowest `sortOrder` — built-ins (0..3) beat user adds (100); within
 *      user-adds, an earlier explicit ordering beats default.
 *   3. Earliest `createdAt` — stable tiebreak; the first one created wins.
 */
function pickCanonical(rows: Category[]): Category {
  const sorted = [...rows].sort((a, b) => {
    const aBuiltIn = isBuiltInId(a.id) ? 0 : 1
    const bBuiltIn = isBuiltInId(b.id) ? 0 : 1
    if (aBuiltIn !== bBuiltIn) return aBuiltIn - bBuiltIn
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.createdAt.localeCompare(b.createdAt)
  })
  return sorted[0]!
}

/**
 * Merge duplicate-by-lowercased-label categories into one canonical row each,
 * reassigning all `categoryId` foreign keys on commitments / intentions /
 * marketEntries to the canonical id, then deleting the dupe rows.
 *
 * Atomicity: the entire merge is one Dexie `rw` transaction across all 4
 * affected tables. A mid-flight failure rolls everything back.
 *
 * Idempotent: if no group has >1 row, returns
 *   `{ mergedGroups: 0, removedRows: 0, mergedLabels: [] }` and writes nothing.
 */
export async function dedupeCategoriesInDb(): Promise<DedupeCategoriesResult> {
  const all = await db.categories.toArray()

  // Group by lowercased label.
  const groups = new Map<string, Category[]>()
  for (const row of all) {
    const key = row.label.toLowerCase()
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  // Build a remap: dupeId → canonicalId. Only groups with >1 row contribute.
  const remap = new Map<string, string>()
  const mergedLabels: string[] = []
  const idsToDelete: string[] = []
  for (const [, rows] of groups) {
    if (rows.length <= 1) continue
    const canonical = pickCanonical(rows)
    mergedLabels.push(canonical.label)
    for (const row of rows) {
      if (row.id === canonical.id) continue
      remap.set(row.id, canonical.id)
      idsToDelete.push(row.id)
    }
  }

  if (remap.size === 0) {
    return { mergedGroups: 0, removedRows: 0, mergedLabels: [] }
  }

  const updatedAt = nowISO()

  await db.transaction(
    'rw',
    [db.categories, db.commitments, db.intentions, db.marketEntries],
    async () => {
      // Reassign FK references on all three entity tables.
      for (const [dupeId, canonicalId] of remap) {
        await db.commitments
          .where('categoryId')
          .equals(dupeId)
          .modify({ categoryId: canonicalId, updatedAt })
        await db.intentions
          .where('categoryId')
          .equals(dupeId)
          .modify({ categoryId: canonicalId, updatedAt })
        await db.marketEntries
          .where('categoryId')
          .equals(dupeId)
          .modify({ categoryId: canonicalId })
      }
      // Delete the non-canonical category rows.
      await db.categories.bulkDelete(idsToDelete)
    },
  )

  return {
    mergedGroups: mergedLabels.length,
    removedRows: idsToDelete.length,
    mergedLabels,
  }
}
