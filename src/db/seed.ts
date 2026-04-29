import { db } from './index'
import { nowISO, todayISO, addMonths } from '@/utils/dates'
import { uuid } from '@/utils/uuid'
import { BUILT_IN_CATEGORIES } from './categorySeed'
import type { Category } from './schema'

/**
 * Load sample data for development / first-run preview.
 * Idempotent: clears all tables first, then inserts fresh sample data.
 *
 * Re-seeds built-in categories after the clear so the app is in a usable
 * state even when sample data is loaded from the Settings panel after a
 * previous "Clear all data" wiped them.
 */
export async function seedSampleData(): Promise<void> {
  await clearAllData()

  const now = nowISO()
  const start = addMonths(todayISO(), -6)

  await ensureBuiltInCategories(now)

  const mortgageId = uuid()
  await db.commitments.add({
    id: mortgageId,
    type: 'mortgage',
    label: 'Primary residence mortgage',
    startDate: start,
    principal: 320000,
    annualRate: 0.0475,
    termMonths: 300,
    paymentDay: 1,
    notes: 'Fixed-rate 25-year',
    categoryId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  })

  const shedId = uuid()
  await db.intentions.add({
    id: shedId,
    label: 'Backyard shed',
    targetBudget: 4500,
    status: 'researching',
    notes: 'Looking for ~10x12 with lofted storage',
    categoryId: 'cat-purchases',
    tags: [],
    createdAt: now,
    updatedAt: now,
  })

  await db.marketEntries.bulkAdd([
    {
      id: uuid(),
      intentionId: shedId,
      observedAt: addMonths(todayISO(), -2),
      pricePoint: 5200,
      source: 'Big box retailer',
      availability: 'in-stock',
      notes: 'Baseline price',
      categoryId: null,
      tags: [],
      createdAt: now,
    },
    {
      id: uuid(),
      intentionId: shedId,
      observedAt: addMonths(todayISO(), -1),
      pricePoint: 4800,
      source: 'Local seller',
      availability: 'limited',
      notes: 'Spring promo',
      categoryId: null,
      tags: [],
      createdAt: now,
    },
    {
      id: uuid(),
      intentionId: shedId,
      observedAt: todayISO(),
      pricePoint: 4499,
      source: 'Big box retailer',
      availability: 'in-stock',
      notes: 'Current low',
      categoryId: null,
      tags: [],
      createdAt: now,
    },
  ])
}

/**
 * Reseed the built-in category set if the table is empty.
 *
 * Used by `seedSampleData` after a clear and as defense-in-depth from any
 * UI surface that might want to ensure built-ins are present. Does NOT
 * re-add built-ins that are already there (idempotent), so user re-loads of
 * sample data don't overwrite renamed built-ins.
 */
export async function ensureBuiltInCategories(now: string = nowISO()): Promise<void> {
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

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.commitments,
      db.payments,
      db.intentions,
      db.marketEntries,
      db.categories,
      db.themes,
      db.themeMembers,
    ],
    async () => {
      await db.commitments.clear()
      await db.payments.clear()
      await db.intentions.clear()
      await db.marketEntries.clear()
      await db.categories.clear()
      await db.themes.clear()
      await db.themeMembers.clear()
    },
  )
}

export async function getDbStats(): Promise<{
  commitments: number
  payments: number
  intentions: number
  marketEntries: number
  categories: number
  themes: number
  themeMembers: number
}> {
  const [
    commitments,
    payments,
    intentions,
    marketEntries,
    categories,
    themes,
    themeMembers,
  ] = await Promise.all([
    db.commitments.count(),
    db.payments.count(),
    db.intentions.count(),
    db.marketEntries.count(),
    db.categories.count(),
    db.themes.count(),
    db.themeMembers.count(),
  ])
  return { commitments, payments, intentions, marketEntries, categories, themes, themeMembers }
}
