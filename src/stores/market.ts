import { defineStore } from 'pinia'
import { db } from '@/db'
import type { MarketEntry } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { nowISO } from '@/utils/dates'
import { uuid } from '@/utils/uuid'

export type MarketEntryInput = Omit<MarketEntry, 'id' | 'createdAt'>

export const useMarketStore = defineStore('market', () => {
  const entries = useLiveQuery<MarketEntry[]>(
    () => db.marketEntries.orderBy('observedAt').reverse().toArray(),
    [],
  )

  async function append(input: MarketEntryInput): Promise<string> {
    const record: MarketEntry = {
      id: uuid(),
      ...input,
      createdAt: nowISO(),
    }
    await db.marketEntries.add(record)
    await db.intentions.update(input.intentionId, { updatedAt: nowISO() })
    return record.id
  }

  async function remove(id: string): Promise<void> {
    await db.marketEntries.delete(id)
  }

  async function entriesFor(intentionId: string): Promise<MarketEntry[]> {
    return db.marketEntries
      .where('intentionId')
      .equals(intentionId)
      .sortBy('observedAt')
  }

  return { entries, append, remove, entriesFor }
})
