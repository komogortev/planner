<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntentionsStore, type IntentionInput } from '@/stores/intentions'
import { useMarketStore } from '@/stores/market'
import { useCategoriesStore } from '@/stores/categories'
import type { Intention, IntentionStatus, MarketEntry } from '@/db/schema'
import EmptyState from '@/components/EmptyState.vue'
import StatusPill from '@/components/StatusPill.vue'
import TrendSparkline from '@/components/TrendSparkline.vue'
import CategoryPicker from '@/components/CategoryPicker.vue'
import FilterChip from '@/components/FilterChip.vue'
import { formatDate } from '@/utils/dates'
import { formatMoney } from '@/utils/money'

const store = useIntentionsStore()
const market = useMarketStore()
const categoriesStore = useCategoriesStore()
const route = useRoute()
const router = useRouter()

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<IntentionInput>(emptyForm())

const STATUS_OPTIONS: IntentionStatus[] = [
  'considering',
  'researching',
  'committed',
  'acquired',
  'dropped',
]

/**
 * Category filter — driven by `?category=<id>` route query so links from
 * elsewhere (e.g. CategoriesView usage count) can deep-link into a filtered
 * view. Two-way bound: changing the chip updates the URL, navigating to a
 * URL with a different value updates the chip.
 */
const categoryFilter = computed<string | null>({
  get: () => {
    const q = route.query.category
    return typeof q === 'string' && q !== '' ? q : null
  },
  set: (v) => {
    router.replace({
      query: {
        ...route.query,
        category: v ?? undefined,
      },
    })
  },
})

const categoryFilterOptions = computed(() => [
  { value: '__none__', label: '— Uncategorized —' },
  ...categoriesStore.categories.map((c) => ({ value: c.id, label: c.label })),
])

const filteredIntentions = computed(() => {
  const f = categoryFilter.value
  if (f === null) return store.intentions
  if (f === '__none__') return store.intentions.filter((i) => i.categoryId === null)
  return store.intentions.filter((i) => i.categoryId === f)
})

const grouped = computed(() => {
  const groups: Record<IntentionStatus, Intention[]> = {
    considering: [],
    researching: [],
    committed: [],
    acquired: [],
    dropped: [],
  }
  for (const i of filteredIntentions.value) groups[i.status].push(i)
  return groups
})

function entriesFor(id: string): MarketEntry[] {
  return market.entries
    .filter((e) => e.intentionId === id)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
}

function trendFor(id: string): number[] {
  return entriesFor(id).map((e) => e.pricePoint)
}

function lastPriceFor(id: string): number | null {
  const list = entriesFor(id)
  const last = list[list.length - 1]
  return last ? last.pricePoint : null
}

function emptyForm(): IntentionInput {
  return {
    label: '',
    categoryId: null,
    tags: [],
    targetBudget: null,
    status: 'considering',
    notes: '',
  }
}

function openCreate(): void {
  editingId.value = null
  form.value = emptyForm()
  formOpen.value = true
}

function openEdit(i: Intention): void {
  editingId.value = i.id
  form.value = {
    label: i.label,
    categoryId: i.categoryId,
    tags: i.tags,
    targetBudget: i.targetBudget,
    status: i.status,
    notes: i.notes,
  }
  formOpen.value = true
}

async function saveForm(): Promise<void> {
  if (!form.value.label.trim()) return
  if (editingId.value) {
    await store.update(editingId.value, form.value)
  } else {
    await store.create(form.value)
  }
  formOpen.value = false
  editingId.value = null
}

async function advanceStatus(i: Intention): Promise<void> {
  const idx = STATUS_OPTIONS.indexOf(i.status)
  const next = STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length]!
  await store.update(i.id, { status: next })
}

async function deleteIntention(id: string): Promise<void> {
  if (!confirm('Delete this intention and all its market log entries?')) return
  await store.remove(id)
}

// If the deep-link arrives with a non-existent category id, clear it once
// categories load — avoids confusing "(no matches)" with no clear cause.
watch(
  [() => categoriesStore.categories, categoryFilter],
  ([cats, filter]) => {
    if (filter !== null && filter !== '__none__' && cats.length > 0) {
      if (!cats.some((c) => c.id === filter)) categoryFilter.value = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="max-w-5xl mx-auto w-full px-6 py-8">
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h2 class="text-2xl font-bold">Intentions</h2>
        <p class="text-sm text-slate-500 mt-1">
          Mid-horizon plans. Progress through lifecycle as you decide.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <FilterChip
          v-model="categoryFilter"
          :options="categoryFilterOptions"
          all-label="All categories"
          title="Filter by category"
        />
        <button class="btn-primary" @click="openCreate">+ New</button>
      </div>
    </div>

    <EmptyState
      v-if="store.intentions.length === 0"
      title="No intentions yet"
      description="Track things you're considering, researching, or committing to."
    >
      <button class="btn-primary" @click="openCreate">Add first intention</button>
    </EmptyState>

    <EmptyState
      v-else-if="filteredIntentions.length === 0"
      title="No intentions match this filter"
      description="Try a different category or clear the filter."
    >
      <button class="btn-ghost" @click="categoryFilter = null">Clear filter</button>
    </EmptyState>

    <div v-else class="space-y-8">
      <section
        v-for="status in STATUS_OPTIONS"
        :key="status"
        v-show="grouped[status].length > 0"
      >
        <div class="flex items-center gap-3 mb-3">
          <h3 class="text-sm font-semibold uppercase tracking-widest text-slate-500">
            {{ status }}
          </h3>
          <span class="text-xs text-slate-600">{{ grouped[status].length }}</span>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <article
            v-for="i in grouped[status]"
            :key="i.id"
            class="card hover:border-indigo-500/40 transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <StatusPill :status="i.status" />
                  <span
                    v-if="i.categoryId"
                    class="text-[10px] uppercase tracking-wider text-indigo-300 border border-indigo-500/40 rounded px-1.5 py-0.5"
                    :title="`Category: ${categoriesStore.labelFor(i.categoryId)}`"
                  >
                    {{ categoriesStore.labelFor(i.categoryId) }}
                  </span>
                </div>
                <h4 class="font-semibold truncate">{{ i.label }}</h4>
                <div class="text-xs text-slate-500 mt-1">
                  Budget: {{ formatMoney(i.targetBudget) }}
                  <span v-if="lastPriceFor(i.id) !== null" class="ml-2">
                    · Last: {{ formatMoney(lastPriceFor(i.id)) }}
                  </span>
                </div>
                <p v-if="i.notes" class="text-sm text-slate-400 mt-2 line-clamp-2">
                  {{ i.notes }}
                </p>
              </div>
              <TrendSparkline :values="trendFor(i.id)" />
            </div>
            <div class="mt-4 flex items-center justify-between text-xs">
              <span class="text-slate-500">Updated {{ formatDate(i.updatedAt) }}</span>
              <div class="flex gap-1">
                <button class="btn-ghost !px-2 !py-1 !text-xs" @click="advanceStatus(i)">
                  → next
                </button>
                <button class="btn-ghost !px-2 !py-1 !text-xs" @click="openEdit(i)">
                  Edit
                </button>
                <button
                  class="btn-ghost !px-2 !py-1 !text-xs hover:!bg-rose-900/40 hover:text-rose-300"
                  @click="deleteIntention(i.id)"
                >
                  Del
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>

    <!-- Form drawer -->
    <div
      v-if="formOpen"
      class="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 p-4"
      @click.self="formOpen = false"
    >
      <div class="w-full max-w-lg card">
        <h3 class="text-lg font-bold mb-4">
          {{ editingId ? 'Edit intention' : 'New intention' }}
        </h3>
        <form class="space-y-4" @submit.prevent="saveForm">
          <div>
            <label class="label">Label</label>
            <input
              v-model="form.label"
              type="text"
              class="input"
              placeholder="e.g. Backyard shed"
              required
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label">Category</label>
              <CategoryPicker v-model="form.categoryId" />
            </div>
            <div>
              <label class="label">Status</label>
              <select v-model="form.status" class="input">
                <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="label">Target budget</label>
            <input
              :value="form.targetBudget ?? ''"
              type="number"
              step="0.01"
              min="0"
              class="input"
              placeholder="optional"
              @input="
                form.targetBudget =
                  ($event.target as HTMLInputElement).value === ''
                    ? null
                    : Number(($event.target as HTMLInputElement).value)
              "
            />
          </div>
          <div>
            <label class="label">Notes</label>
            <textarea v-model="form.notes" rows="3" class="input" />
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn-ghost" @click="formOpen = false">Cancel</button>
            <button type="submit" class="btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
