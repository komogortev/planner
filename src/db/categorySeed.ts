/**
 * Built-in category seed list — used by both the Dexie v2→v3 upgrade
 * callback and the snapshot v1→v2 forward migration (via `migrations.ts`).
 *
 * Stable ids prefixed `cat-` so built-ins are distinguishable from user-added
 * categories (UUIDs). Built-ins use low `sortOrder` values; user adds default
 * to 100 so they sort below built-ins.
 *
 * The list is intentionally small. New built-ins should NOT be added casually
 * once shipped — any addition needs another schema/migration version bump,
 * since legacy databases won't run the v2→v3 upgrade again.
 */

export interface BuiltInCategorySeed {
  id: string
  label: string
  sortOrder: number
}

export const BUILT_IN_CATEGORIES: readonly BuiltInCategorySeed[] = [
  { id: 'cat-purchases', label: 'Purchases', sortOrder: 0 },
  { id: 'cat-travel', label: 'Travel', sortOrder: 1 },
  { id: 'cat-skill-development', label: 'Skill development', sortOrder: 2 },
  { id: 'cat-subscriptions', label: 'Subscriptions', sortOrder: 3 },
] as const

/** Sort value applied to user-added categories so they appear below built-ins. */
export const USER_CATEGORY_SORT_ORDER = 100

/** Set of built-in ids — used to disable rename/delete for them in the admin UI. */
export const BUILT_IN_CATEGORY_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_CATEGORIES.map((c) => c.id),
)
