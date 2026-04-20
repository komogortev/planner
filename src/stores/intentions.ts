import { defineStore } from 'pinia'
import { db } from '@/db'
import type { Intention } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { nowISO } from '@/utils/dates'
import { uuid } from '@/utils/uuid'

export type IntentionInput = Omit<Intention, 'id' | 'createdAt' | 'updatedAt'>

export const useIntentionsStore = defineStore('intentions', () => {
  const intentions = useLiveQuery<Intention[]>(
    () => db.intentions.orderBy('updatedAt').reverse().toArray(),
    [],
  )

  async function create(input: IntentionInput): Promise<string> {
    const now = nowISO()
    const record: Intention = {
      id: uuid(),
      ...input,
      createdAt: now,
      updatedAt: now,
    }
    await db.intentions.add(record)
    return record.id
  }

  async function update(id: string, patch: Partial<IntentionInput>): Promise<void> {
    await db.intentions.update(id, { ...patch, updatedAt: nowISO() })
  }

  async function remove(id: string): Promise<void> {
    await db.transaction('rw', db.intentions, db.marketEntries, async () => {
      await db.marketEntries.where('intentionId').equals(id).delete()
      await db.intentions.delete(id)
    })
  }

  async function getById(id: string): Promise<Intention | undefined> {
    return db.intentions.get(id)
  }

  return { intentions, create, update, remove, getById }
})
