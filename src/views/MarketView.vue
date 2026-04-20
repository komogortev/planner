<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIntentionsStore } from '@/stores/intentions'
import { useMarketStore, type MarketEntryInput } from '@/stores/market'
import type { MarketAvailability, MarketEntry } from '@/db/schema'
import EmptyState from '@/components/EmptyState.vue'
import TrendSparkline from '@/components/TrendSparkline.vue'
import { formatDate, todayISO } from '@/utils/dates'
import { formatMoney } from '@/utils/money'

const intentionsStore = useIntentionsStore()
const marketStore = useMarketStore()

const selectedIntentionId = ref<string | null>(null)
const entries = ref<MarketEntry[]>([])

const form = ref<Omit<MarketEntryInput, 'intentionId'>>({
  observedAt: todayISO(),
  pricePoint: 0,
  source: '',
  availability: 'in-stock',
  notes: '',
})

const selectedIntention = computed(() =>
  intentionsStore.intentions.find((i) => i.id === selectedIntentionId.value) ?? null,
)

watch(
  () => intentionsStore.intentions,
  (list) => {
    if (!selectedIntentionId.value && list.length > 0) {
      selectedIntentionId.value = list[0]!.id
    }
  },
  { immediate: true },
)

watch(
  [selectedIntentionId, () => marketStore.entries.length],
  async () => {
    if (!selectedIntentionId.value) {
      entries.value = []
      return
    }
    entries.value = await marketStore.entriesFor(selectedIntentionId.value)
  },
  { immediate: true },
)

const trendValues = computed(() => entries.value.map((e) => e.pricePoint))

const stats = computed(() => {
  if (entries.value.length === 0) {
    return { min: null as number | null, max: null as number | null, last: null as number | null }
  }
  const prices = entries.value.map((e) => e.pricePoint)
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    last: prices[prices.length - 1] ?? null,
  }
})

async function append(): Promise<void> {
  if (!selectedIntentionId.value) return
  if (form.value.pricePoint <= 0) return
  await marketStore.append({
    intentionId: selectedIntentionId.value,
    observedAt: form.value.observedAt,
    pricePoint: form.value.pricePoint,
    source: form.value.source,
    availability: form.value.availability,
    notes: form.value.notes,
  })
  form.value = {
    observedAt: todayISO(),
    pricePoint: 0,
    source: form.value.source, // keep last source for rapid entry
    availability: 'in-stock',
    notes: '',
  }
}

async function remove(id: string): Promise<void> {
  if (!confirm('Remove this market log entry?')) return
  await marketStore.remove(id)
}

const availabilityOptions: { value: MarketAvailability; label: string }[] = [
  { value: 'in-stock', label: 'In stock' },
  { value: 'limited', label: 'Limited' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: null, label: '(unknown)' },
]
</script>

<template>
  <div class="max-w-5xl mx-auto w-full px-6 py-8">
    <div class="mb-6">
      <h2 class="text-2xl font-bold">Market Log</h2>
      <p class="text-sm text-slate-500 mt-1">
        Append-only price + availability observations per intention. Build a trend over time.
      </p>
    </div>

    <EmptyState
      v-if="intentionsStore.intentions.length === 0"
      title="No intentions to track"
      description="Create an intention first, then log market observations here."
    />

    <div v-else class="space-y-6">
      <div class="card">
        <label class="label">Intention</label>
        <select v-model="selectedIntentionId" class="input max-w-md">
          <option
            v-for="i in intentionsStore.intentions"
            :key="i.id"
            :value="i.id"
          >
            {{ i.label }} ({{ i.status }})
          </option>
        </select>
      </div>

      <div v-if="selectedIntention" class="card">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h3 class="font-semibold">{{ selectedIntention.label }}</h3>
            <div class="text-xs text-slate-500 mt-1">
              Budget: {{ formatMoney(selectedIntention.targetBudget) }}
            </div>
          </div>
          <TrendSparkline :values="trendValues" :width="200" :height="48" />
        </div>
        <dl class="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Min</dt>
            <dd class="font-semibold mt-1 text-emerald-400">{{ formatMoney(stats.min) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Max</dt>
            <dd class="font-semibold mt-1 text-rose-400">{{ formatMoney(stats.max) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500 uppercase tracking-wider">Last</dt>
            <dd class="font-semibold mt-1">{{ formatMoney(stats.last) }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="selectedIntention" class="card">
        <h4 class="font-semibold mb-4">Append entry</h4>
        <form class="grid sm:grid-cols-[1fr_1fr_1fr_1fr] gap-3" @submit.prevent="append">
          <div>
            <label class="label">Date</label>
            <input v-model="form.observedAt" type="date" class="input" required />
          </div>
          <div>
            <label class="label">Price</label>
            <input
              v-model.number="form.pricePoint"
              type="number"
              step="0.01"
              min="0"
              class="input"
              required
            />
          </div>
          <div>
            <label class="label">Source</label>
            <input v-model="form.source" type="text" class="input" placeholder="retailer, url…" />
          </div>
          <div>
            <label class="label">Availability</label>
            <select
              :value="form.availability ?? ''"
              class="input"
              @change="
                form.availability =
                  ($event.target as HTMLSelectElement).value === ''
                    ? null
                    : (($event.target as HTMLSelectElement).value as MarketAvailability)
              "
            >
              <option v-for="o in availabilityOptions" :key="String(o.value)" :value="o.value ?? ''">
                {{ o.label }}
              </option>
            </select>
          </div>
          <div class="sm:col-span-3">
            <label class="label">Notes</label>
            <input v-model="form.notes" type="text" class="input" placeholder="Optional" />
          </div>
          <div class="flex items-end">
            <button type="submit" class="btn-primary w-full">Append</button>
          </div>
        </form>
      </div>

      <div v-if="selectedIntention" class="card">
        <h4 class="font-semibold mb-4">
          History
          <span class="text-xs font-normal text-slate-500 ml-2">({{ entries.length }})</span>
        </h4>
        <div v-if="entries.length === 0" class="text-sm text-slate-500">
          No entries yet — append one above.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th class="pb-2 pr-4 font-medium">Date</th>
                <th class="pb-2 pr-4 font-medium text-right">Price</th>
                <th class="pb-2 pr-4 font-medium">Source</th>
                <th class="pb-2 pr-4 font-medium">Availability</th>
                <th class="pb-2 pr-4 font-medium">Notes</th>
                <th class="pb-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800">
              <tr v-for="e in [...entries].reverse()" :key="e.id">
                <td class="py-2 pr-4">{{ formatDate(e.observedAt) }}</td>
                <td class="py-2 pr-4 text-right font-semibold">{{ formatMoney(e.pricePoint) }}</td>
                <td class="py-2 pr-4 text-slate-400">{{ e.source || '—' }}</td>
                <td class="py-2 pr-4 text-slate-400">{{ e.availability ?? '—' }}</td>
                <td class="py-2 pr-4 text-slate-400">{{ e.notes || '—' }}</td>
                <td class="py-2 text-right">
                  <button
                    class="text-xs text-slate-500 hover:text-rose-400"
                    @click="remove(e.id)"
                  >
                    remove
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
