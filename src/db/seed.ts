import { db } from './index'
import { nowISO, todayISO, addMonths } from '@/utils/dates'
import { uuid } from '@/utils/uuid'

/**
 * Load sample data for development / first-run preview.
 * Idempotent: clears all tables first, then inserts fresh sample data.
 */
export async function seedSampleData(): Promise<void> {
  await clearAllData()

  const now = nowISO()
  const start = addMonths(todayISO(), -6)

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
    createdAt: now,
    updatedAt: now,
  })

  const shedId = uuid()
  await db.intentions.add({
    id: shedId,
    label: 'Backyard shed',
    category: 'home',
    targetBudget: 4500,
    status: 'researching',
    notes: 'Looking for ~10x12 with lofted storage',
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
      createdAt: now,
    },
  ])
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    db.commitments,
    db.payments,
    db.intentions,
    db.marketEntries,
    async () => {
      await db.commitments.clear()
      await db.payments.clear()
      await db.intentions.clear()
      await db.marketEntries.clear()
    },
  )
}

export async function getDbStats(): Promise<{
  commitments: number
  payments: number
  intentions: number
  marketEntries: number
}> {
  const [commitments, payments, intentions, marketEntries] = await Promise.all([
    db.commitments.count(),
    db.payments.count(),
    db.intentions.count(),
    db.marketEntries.count(),
  ])
  return { commitments, payments, intentions, marketEntries }
}
