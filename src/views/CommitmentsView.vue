<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCommitmentsStore, type CommitmentInput, type PaymentInput } from '@/stores/commitments'
import type { Commitment, CommitmentType, Payment } from '@/db/schema'
import EmptyState from '@/components/EmptyState.vue'
import { formatDate, todayISO } from '@/utils/dates'
import { formatMoney } from '@/utils/money'
import { computeAmortization, monthlyPayment } from '@/utils/amortization'

const store = useCommitmentsStore()

const selectedId = ref<string | null>(null)
const selected = computed(() =>
  store.commitments.find((c) => c.id === selectedId.value) ?? null,
)

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<CommitmentInput>(emptyForm())
const paymentForm = ref<Omit<PaymentInput, 'commitmentId'>>({
  date: todayISO(),
  amount: 0,
  notes: '',
})

const paymentsForSelected = ref<Payment[]>([])

watch(
  [selected, () => store.payments.length],
  async () => {
    if (!selected.value) {
      paymentsForSelected.value = []
      return
    }
    paymentsForSelected.value = await store.paymentsFor(selected.value.id)
  },
  { immediate: true },
)

function emptyForm(): CommitmentInput {
  return {
    type: 'mortgage',
    label: '',
    startDate: todayISO(),
    principal: 100000,
    annualRate: 0.05,
    termMonths: 360,
    paymentDay: 1,
    notes: '',
  }
}

function openCreate(): void {
  editingId.value = null
  form.value = emptyForm()
  formOpen.value = true
}

function openEdit(c: Commitment): void {
  editingId.value = c.id
  form.value = {
    type: c.type,
    label: c.label,
    startDate: c.startDate,
    principal: c.principal,
    annualRate: c.annualRate,
    termMonths: c.termMonths,
    paymentDay: c.paymentDay,
    notes: c.notes,
  }
  formOpen.value = true
}

function closeForm(): void {
  formOpen.value = false
  editingId.value = null
}

async function saveForm(): Promise<void> {
  if (!form.value.label.trim()) return
  if (editingId.value) {
    await store.update(editingId.value, form.value)
  } else {
    const id = await store.create(form.value)
    selectedId.value = id
  }
  closeForm()
}

async function deleteCommitment(id: string): Promise<void> {
  if (!confirm('Delete this commitment and all its payments?')) return
  await store.remove(id)
  if (selectedId.value === id) selectedId.value = null
}

async function logPayment(): Promise<void> {
  if (!selected.value) return
  if (paymentForm.value.amount <= 0) return
  await store.logPayment({
    commitmentId: selected.value.id,
    date: paymentForm.value.date,
    amount: paymentForm.value.amount,
    notes: paymentForm.value.notes,
  })
  paymentForm.value = { date: todayISO(), amount: 0, notes: '' }
}

async function deletePayment(id: string): Promise<void> {
  if (!confirm('Delete this payment?')) return
  await store.removePayment(id)
}

const scheduledMonthly = computed(() => {
  if (!selected.value) return 0
  return monthlyPayment(
    selected.value.principal,
    selected.value.annualRate,
    selected.value.termMonths,
  )
})

const schedulePreview = computed(() => {
  if (!selected.value) return []
  return computeAmortization({
    principal: selected.value.principal,
    annualRate: selected.value.annualRate,
    termMonths: selected.value.termMonths,
    startDate: selected.value.startDate,
  }).slice(0, 12)
})

const currentBalance = computed(() => {
  if (!selected.value) return 0
  const paid = paymentsForSelected.value.reduce(
    (sum, p) => sum + p.principalPortion,
    0,
  )
  return Math.max(0, selected.value.principal - paid)
})

const typeOptions: { value: CommitmentType; label: string }[] = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'loan', label: 'Loan' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'other', label: 'Other' },
]

function ratePercent(r: number): string {
  return `${(r * 100).toFixed(3)}%`
}
</script>

<template>
  <div class="max-w-5xl mx-auto w-full px-6 py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold">Commitments</h2>
        <p class="text-sm text-slate-500 mt-1">
          Fixed-schedule obligations. Log actual payments to track balance.
        </p>
      </div>
      <button class="btn-primary" @click="openCreate">+ New</button>
    </div>

    <EmptyState
      v-if="store.commitments.length === 0"
      title="No commitments yet"
      description="Add a mortgage, loan, or recurring subscription to start tracking."
    >
      <button class="btn-primary" @click="openCreate">Add first commitment</button>
    </EmptyState>

    <div v-else class="grid md:grid-cols-[320px_1fr] gap-6">
      <aside class="space-y-2">
        <button
          v-for="c in store.commitments"
          :key="c.id"
          class="w-full text-left card hover:border-indigo-500/50 transition-colors"
          :class="{
            'border-indigo-500 ring-1 ring-indigo-500': selectedId === c.id,
          }"
          @click="selectedId = c.id"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs uppercase tracking-wider text-slate-500">
              {{ c.type }}
            </span>
            <span class="text-xs text-slate-500">{{ formatDate(c.startDate) }}</span>
          </div>
          <div class="mt-1 font-semibold truncate">{{ c.label || '(unnamed)' }}</div>
          <div class="mt-1 text-sm text-slate-400">
            {{ formatMoney(c.principal) }} · {{ ratePercent(c.annualRate) }} · {{ c.termMonths }}mo
          </div>
        </button>
      </aside>

      <section v-if="selected" class="space-y-6">
        <div class="card">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xs uppercase tracking-wider text-slate-500">
                {{ selected.type }}
              </div>
              <h3 class="text-xl font-bold mt-1">{{ selected.label }}</h3>
            </div>
            <div class="flex gap-2">
              <button class="btn-ghost" @click="openEdit(selected)">Edit</button>
              <button class="btn-danger" @click="deleteCommitment(selected.id)">Delete</button>
            </div>
          </div>

          <dl class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
            <div>
              <dt class="text-xs text-slate-500 uppercase tracking-wider">Principal</dt>
              <dd class="font-semibold mt-1">{{ formatMoney(selected.principal) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500 uppercase tracking-wider">Balance</dt>
              <dd class="font-semibold mt-1 text-indigo-300">{{ formatMoney(currentBalance) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500 uppercase tracking-wider">Rate</dt>
              <dd class="font-semibold mt-1">{{ ratePercent(selected.annualRate) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500 uppercase tracking-wider">Scheduled/mo</dt>
              <dd class="font-semibold mt-1">{{ formatMoney(scheduledMonthly) }}</dd>
            </div>
          </dl>

          <p v-if="selected.notes" class="text-sm text-slate-400 mt-4 whitespace-pre-wrap">
            {{ selected.notes }}
          </p>
        </div>

        <div class="card">
          <h4 class="font-semibold mb-4">Log payment</h4>
          <form class="grid sm:grid-cols-[1fr_1fr_2fr_auto] gap-3" @submit.prevent="logPayment">
            <div>
              <label class="label">Date</label>
              <input v-model="paymentForm.date" type="date" class="input" required />
            </div>
            <div>
              <label class="label">Amount</label>
              <input
                v-model.number="paymentForm.amount"
                type="number"
                step="0.01"
                min="0"
                class="input"
                required
              />
            </div>
            <div>
              <label class="label">Notes</label>
              <input v-model="paymentForm.notes" type="text" class="input" placeholder="Optional" />
            </div>
            <div class="flex items-end">
              <button type="submit" class="btn-primary">Log</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h4 class="font-semibold mb-4">
            Payment history
            <span class="text-xs font-normal text-slate-500 ml-2">
              ({{ paymentsForSelected.length }})
            </span>
          </h4>
          <div v-if="paymentsForSelected.length === 0" class="text-sm text-slate-500">
            No payments logged yet.
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th class="pb-2 pr-4 font-medium">Date</th>
                  <th class="pb-2 pr-4 font-medium text-right">Amount</th>
                  <th class="pb-2 pr-4 font-medium text-right">Principal</th>
                  <th class="pb-2 pr-4 font-medium text-right">Interest</th>
                  <th class="pb-2 pr-4 font-medium text-right">Balance</th>
                  <th class="pb-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                <tr v-for="p in [...paymentsForSelected].reverse()" :key="p.id">
                  <td class="py-2 pr-4">{{ formatDate(p.date) }}</td>
                  <td class="py-2 pr-4 text-right">{{ formatMoney(p.amount) }}</td>
                  <td class="py-2 pr-4 text-right text-emerald-400">
                    {{ formatMoney(p.principalPortion) }}
                  </td>
                  <td class="py-2 pr-4 text-right text-slate-400">
                    {{ formatMoney(p.interestPortion) }}
                  </td>
                  <td class="py-2 pr-4 text-right">{{ formatMoney(p.balanceAfter) }}</td>
                  <td class="py-2 text-right">
                    <button
                      class="text-xs text-slate-500 hover:text-rose-400"
                      @click="deletePayment(p.id)"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <details class="card">
          <summary class="font-semibold cursor-pointer">Scheduled amortization (first 12 months)</summary>
          <div class="overflow-x-auto mt-4">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th class="pb-2 pr-4 font-medium">#</th>
                  <th class="pb-2 pr-4 font-medium">Date</th>
                  <th class="pb-2 pr-4 font-medium text-right">Payment</th>
                  <th class="pb-2 pr-4 font-medium text-right">Principal</th>
                  <th class="pb-2 pr-4 font-medium text-right">Interest</th>
                  <th class="pb-2 pr-4 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                <tr v-for="row in schedulePreview" :key="row.index">
                  <td class="py-1.5 pr-4 text-slate-500">{{ row.index }}</td>
                  <td class="py-1.5 pr-4">{{ formatDate(row.date) }}</td>
                  <td class="py-1.5 pr-4 text-right">{{ formatMoney(row.payment) }}</td>
                  <td class="py-1.5 pr-4 text-right text-emerald-400">{{ formatMoney(row.principal) }}</td>
                  <td class="py-1.5 pr-4 text-right text-slate-400">{{ formatMoney(row.interest) }}</td>
                  <td class="py-1.5 pr-4 text-right">{{ formatMoney(row.balance) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section v-else class="text-sm text-slate-500">
        Select a commitment to view details.
      </section>
    </div>

    <!-- Form drawer -->
    <div
      v-if="formOpen"
      class="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 p-4"
      @click.self="closeForm"
    >
      <div class="w-full max-w-lg card">
        <h3 class="text-lg font-bold mb-4">
          {{ editingId ? 'Edit commitment' : 'New commitment' }}
        </h3>
        <form class="space-y-4" @submit.prevent="saveForm">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Type</label>
              <select v-model="form.type" class="input">
                <option v-for="o in typeOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div>
              <label class="label">Start date</label>
              <input v-model="form.startDate" type="date" class="input" required />
            </div>
          </div>
          <div>
            <label class="label">Label</label>
            <input
              v-model="form.label"
              type="text"
              class="input"
              placeholder="e.g. Primary residence mortgage"
              required
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Principal</label>
              <input
                v-model.number="form.principal"
                type="number"
                step="0.01"
                min="0"
                class="input"
                required
              />
            </div>
            <div>
              <label class="label">Annual rate (decimal)</label>
              <input
                v-model.number="form.annualRate"
                type="number"
                step="0.0001"
                min="0"
                class="input"
                required
              />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Term (months)</label>
              <input
                v-model.number="form.termMonths"
                type="number"
                step="1"
                min="1"
                class="input"
                required
              />
            </div>
            <div>
              <label class="label">Payment day</label>
              <input
                v-model.number="form.paymentDay"
                type="number"
                step="1"
                min="1"
                max="31"
                class="input"
                required
              />
            </div>
          </div>
          <div>
            <label class="label">Notes</label>
            <textarea v-model="form.notes" rows="2" class="input" />
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn-ghost" @click="closeForm">Cancel</button>
            <button type="submit" class="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
