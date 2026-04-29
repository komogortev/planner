import { defineStore } from 'pinia'
import { db } from '@/db'
import type { Category } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { nowISO } from '@/utils/dates'
import { uuid } from '@/utils/uuid'
import {
  BUILT_IN_CATEGORIES,
  BUILT_IN_CATEGORY_IDS,
  USER_CATEGORY_SORT_ORDER,
} from '@/db/categorySeed'

/**
 * L2 — categories store.
 *
 * Reactive list ordered by `(sortOrder, label)` so built-ins come first in a
 * stable display order (sortOrder 0..3) and user adds (sortOrder 100) follow
 * sorted by label.
 *
 * Deletion semantics (Q1 resolution): refuse delete when in use. Callers
 * inspect `usageCount` before calling `remove`. The store exposes
 * `usageFor(id)` which counts FK references across the 3 entity tables.
 */
export interface CategoryInput {
  label: string
  sortOrder?: number
}

export interface CategoryUsage {
  commitments: number
  intentions: number
  marketEntries: number
  total: number
}

export const useCategoriesStore = defineStore('categories', () => {
  const categories = useLiveQuery<Category[]>(
    () =>
      db.categories
        .toArray()
        .then((rows) =>
          rows.sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
          ),
        ),
    [],
  )

  function isBuiltIn(id: string): boolean {
    return BUILT_IN_CATEGORY_IDS.has(id)
  }

  /**
   * Idempotent — does not create duplicates if a built-in already exists.
   * Useful as defense in case a user clears all data after the v3 upgrade.
   */
  async function ensureBuiltIns(): Promise<void> {
    const now = nowISO()
    const existing = await db.categories.bulkGet(BUILT_IN_CATEGORIES.map((c) => c.id))
    const missing: Category[] = []
    for (let i = 0; i < BUILT_IN_CATEGORIES.length; i++) {
      if (!existing[i]) {
        const seed = BUILT_IN_CATEGORIES[i]!
        missing.push({
          id: seed.id,
          label: seed.label,
          sortOrder: seed.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
    if (missing.length > 0) {
      await db.categories.bulkAdd(missing)
    }
  }

  async function create(input: CategoryInput): Promise<string> {
    const now = nowISO()
    const record: Category = {
      id: uuid(),
      label: input.label.trim(),
      sortOrder: input.sortOrder ?? USER_CATEGORY_SORT_ORDER,
      createdAt: now,
      updatedAt: now,
    }
    if (record.label === '') {
      throw new Error('Category label is required')
    }
    await db.categories.add(record)
    return record.id
  }

  async function rename(id: string, newLabel: string): Promise<void> {
    const trimmed = newLabel.trim()
    if (trimmed === '') throw new Error('Category label is required')
    await db.categories.update(id, { label: trimmed, updatedAt: nowISO() })
  }

  /**
   * Hard delete — caller MUST check `usageFor(id)` first and refuse to call
   * this if any usage exists. The Categories admin enforces that with a
   * disabled button + tooltip.
   *
   * As defense-in-depth, this also runs the usage check inside a Dexie
   * transaction and aborts if any references exist by the time we look.
   */
  async function remove(id: string): Promise<void> {
    if (isBuiltIn(id)) {
      throw new Error('Built-in categories cannot be deleted')
    }
    await db.transaction(
      'rw',
      [db.categories, db.commitments, db.intentions, db.marketEntries],
      async () => {
        const [c, i, m] = await Promise.all([
          db.commitments.where('categoryId').equals(id).count(),
          db.intentions.where('categoryId').equals(id).count(),
          db.marketEntries.where('categoryId').equals(id).count(),
        ])
        if (c + i + m > 0) {
          throw new Error(
            `Category is in use by ${c + i + m} record(s). Reassign them before deleting.`,
          )
        }
        await db.categories.delete(id)
      },
    )
  }

  async function usageFor(id: string): Promise<CategoryUsage> {
    const [commitments, intentions, marketEntries] = await Promise.all([
      db.commitments.where('categoryId').equals(id).count(),
      db.intentions.where('categoryId').equals(id).count(),
      db.marketEntries.where('categoryId').equals(id).count(),
    ])
    return {
      commitments,
      intentions,
      marketEntries,
      total: commitments + intentions + marketEntries,
    }
  }

  /** Convenience lookup. Returns undefined for null/missing ids. */
  function getById(id: string | null | undefined): Category | undefined {
    if (!id) return undefined
    return categories.value.find((c) => c.id === id)
  }

  /** Convenience: just the display label (or '' for null/missing). */
  function labelFor(id: string | null | undefined): string {
    return getById(id)?.label ?? ''
  }

  return {
    categories,
    isBuiltIn,
    ensureBuiltIns,
    create,
    rename,
    remove,
    usageFor,
    getById,
    labelFor,
  }
})
