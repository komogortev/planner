<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useCommitmentsStore } from '@/stores/commitments'
import { useIntentionsStore } from '@/stores/intentions'
import { useMarketStore } from '@/stores/market'
import StatusPill from '@/components/StatusPill.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatDate } from '@/utils/dates'
import { formatMoney } from '@/utils/money'
import { monthlyPayment } from '@/utils/amortization'

const commitments = useCommitmentsStore()
const intentions = useIntentionsStore()
const market = useMarketStore()

const totalMonthlyCommitted = computed(() =>
  commitments.commitments.reduce(
    (sum, c) => sum + monthlyPayment(c.principal, c.annualRate, c.termMonths),
    0,
  ),
)

const activeIntentions = computed(() =>
  intentions.intentions.filter(
    (i) => i.status !== 'acquired' && i.status !== 'dropped',
  ),
)

const recentMarket = computed(() =>
  [...market.entries]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, 5),
)

function intentionLabel(id: string): string {
  return intentions.intentions.find((i) => i.id === id)?.label ?? '(removed)'
}

const hasAny = computed(
  () =>
    commitments.commitments.length > 0 ||
    intentions.intentions.length > 0 ||
    market.entries.length > 0,
)
</script>

<template>
  <div class="max-w-5xl mx-auto w-full px-6 py-8 space-y-8">
    <header>
      <h2 class="text-2xl font-bold">Dashboard</h2>
      <p class="text-sm text-slate-500 mt-1">
        Overview of commitments, active intentions, and recent market signals.
      </p>
    </header>

    <EmptyState
      v-if="!hasAny"
      title="Welcome to your planner"
      description="Start by seeding sample data, or add your first commitment or intention."
    >
      <div class="flex items-center gap-2 justify-center">
        <RouterLink to="/commitments" class="btn-primary">Add commitment</RouterLink>
        <RouterLink to="/intentions" class="btn-ghost">Add intention</RouterLink>
        <RouterLink to="/settings" class="btn-ghost">Settings</RouterLink>
      </div>
    </EmptyState>

    <div v-else class="grid md:grid-cols-3 gap-4">
      <RouterLink
        to="/commitments"
        class="card hover:border-indigo-500/50 transition-colors block"
      >
        <div class="text-xs uppercase tracking-wider text-slate-500">Commitments</div>
        <div class="text-3xl font-bold mt-2">{{ commitments.commitments.length }}</div>
        <div class="text-sm text-slate-400 mt-2">
          {{ formatMoney(totalMonthlyCommitted) }} / month scheduled
        </div>
      </RouterLink>

      <RouterLink
        to="/intentions"
        class="card hover:border-indigo-500/50 transition-colors block"
      >
        <div class="text-xs uppercase tracking-wider text-slate-500">Active intentions</div>
        <div class="text-3xl font-bold mt-2">{{ activeIntentions.length }}</div>
        <div class="text-sm text-slate-400 mt-2">
          of {{ intentions.intentions.length }} total
        </div>
      </RouterLink>

      <RouterLink
        to="/market"
        class="card hover:border-indigo-500/50 transition-colors block"
      >
        <div class="text-xs uppercase tracking-wider text-slate-500">Market entries</div>
        <div class="text-3xl font-bold mt-2">{{ market.entries.length }}</div>
        <div class="text-sm text-slate-400 mt-2">
          logged observations
        </div>
      </RouterLink>
    </div>

    <div v-if="activeIntentions.length > 0" class="card">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold">Active intentions</h3>
        <RouterLink to="/intentions" class="text-xs text-indigo-400 hover:text-indigo-300">
          View all →
        </RouterLink>
      </div>
      <ul class="divide-y divide-slate-800">
        <li
          v-for="i in activeIntentions.slice(0, 5)"
          :key="i.id"
          class="py-3 flex items-center justify-between gap-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <StatusPill :status="i.status" />
              <span class="font-medium truncate">{{ i.label }}</span>
            </div>
            <div class="text-xs text-slate-500 mt-1">
              Budget: {{ formatMoney(i.targetBudget) }}
              <span v-if="i.category"> · {{ i.category }}</span>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="recentMarket.length > 0" class="card">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold">Recent market signals</h3>
        <RouterLink to="/market" class="text-xs text-indigo-400 hover:text-indigo-300">
          View all →
        </RouterLink>
      </div>
      <ul class="divide-y divide-slate-800">
        <li
          v-for="e in recentMarket"
          :key="e.id"
          class="py-2.5 flex items-center justify-between gap-4 text-sm"
        >
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ intentionLabel(e.intentionId) }}</div>
            <div class="text-xs text-slate-500">
              {{ formatDate(e.observedAt) }}
              <span v-if="e.source"> · {{ e.source }}</span>
            </div>
          </div>
          <div class="font-semibold">{{ formatMoney(e.pricePoint) }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>
