import { defineStore } from 'pinia'
import { db } from '@/db'
import type { Commitment, Payment } from '@/db/schema'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { nowISO } from '@/utils/dates'
import { splitPayment } from '@/utils/amortization'
import { uuid } from '@/utils/uuid'

export type CommitmentInput = Omit<Commitment, 'id' | 'createdAt' | 'updatedAt'>
export type PaymentInput = Pick<Payment, 'commitmentId' | 'date' | 'amount' | 'notes'>

export const useCommitmentsStore = defineStore('commitments', () => {
  const commitments = useLiveQuery<Commitment[]>(
    () => db.commitments.orderBy('updatedAt').reverse().toArray(),
    [],
  )
  const payments = useLiveQuery<Payment[]>(
    () => db.payments.orderBy('date').reverse().toArray(),
    [],
  )

  async function create(input: CommitmentInput): Promise<string> {
    const now = nowISO()
    const record: Commitment = {
      id: uuid(),
      ...input,
      createdAt: now,
      updatedAt: now,
    }
    await db.commitments.add(record)
    return record.id
  }

  async function update(id: string, patch: Partial<CommitmentInput>): Promise<void> {
    await db.commitments.update(id, { ...patch, updatedAt: nowISO() })
  }

  async function remove(id: string): Promise<void> {
    await db.transaction('rw', db.commitments, db.payments, async () => {
      await db.payments.where('commitmentId').equals(id).delete()
      await db.commitments.delete(id)
    })
  }

  async function getById(id: string): Promise<Commitment | undefined> {
    return db.commitments.get(id)
  }

  async function paymentsFor(commitmentId: string): Promise<Payment[]> {
    return db.payments
      .where('commitmentId')
      .equals(commitmentId)
      .sortBy('date')
  }

  /**
   * Log an actual payment. Computes principal/interest split from the
   * remaining balance (principal minus sum of prior principal portions).
   */
  async function logPayment(input: PaymentInput): Promise<string> {
    const commitment = await db.commitments.get(input.commitmentId)
    if (!commitment) throw new Error(`Commitment ${input.commitmentId} not found`)

    const priorPayments = await paymentsFor(input.commitmentId)
    const priorPrincipalTotal = priorPayments.reduce(
      (sum, p) => sum + p.principalPortion,
      0,
    )
    const priorBalance = Math.max(0, commitment.principal - priorPrincipalTotal)

    const { principal, interest, balanceAfter } = splitPayment(
      input.amount,
      priorBalance,
      commitment.annualRate,
    )

    const record: Payment = {
      id: uuid(),
      commitmentId: input.commitmentId,
      date: input.date,
      amount: input.amount,
      principalPortion: principal,
      interestPortion: interest,
      balanceAfter,
      notes: input.notes,
      createdAt: nowISO(),
    }
    await db.payments.add(record)
    await db.commitments.update(input.commitmentId, { updatedAt: nowISO() })
    return record.id
  }

  async function removePayment(id: string): Promise<void> {
    await db.payments.delete(id)
  }

  return {
    commitments,
    payments,
    create,
    update,
    remove,
    getById,
    paymentsFor,
    logPayment,
    removePayment,
  }
})
