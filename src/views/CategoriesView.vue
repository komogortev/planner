<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCategoriesStore, type CategoryUsage } from '@/stores/categories'
import { useRouter } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import { formatDate } from '@/utils/dates'

/**
 * CategoriesView — admin for L2 Category entities.
 *
 * Surfaces:
 *   - Built-in categories (rename only — delete refused, locked id prefix).
 *   - User categories (CRUD; delete refused when in use, with reassign link).
 *
 * Refuse-delete-when-in-use semantics (Q1 resolution): each row shows its
 * usage count (across the 3 domain entity tables). Delete button disabled
 * with tooltip + reassign-link CTA when count > 0.
 */
const store = useCategoriesStore()
const router = useRouter()

const newLabel = ref('')
const formError = ref<string | null>(null)
const submitting = ref(false)

/** Per-id usage cache. Reactive so refresh() can invalidate the row's display. */
const usage = ref<Record<string, CategoryUsage>>({})
const usageLoading = ref(false)

/** Inline-rename state. Only one row at a time. */
const renamingId = ref<string | null>(null)
const renameDraft = ref('')

async function refreshUsage(): Promise<void> {
  usageLoading.value = true
  try {
    const next: Record<string, CategoryUsage> = {}
    await Promise.all(
      store.categories.map(async (c) => {
        next[c.id] = await store.usageFor(c.id)
      }),
    )
    usage.value = next
  } finally {
    usageLoading.value = false
  }
}

onMounted(refreshUsage)

async function onCreate(e: Event): Promise<void> {
  e.preventDefault()
  formError.value = null
  const trimmed = newLabel.value.trim()
  if (trimmed === '') {
    formError.value = 'Label is required'
    return
  }
  if (
    store.categories.some(
      (c) => c.label.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    formError.value = `"${trimmed}" already exists`
    return
  }
  submitting.value = true
  try {
    await store.create({ label: trimmed })
    newLabel.value = ''
    await refreshUsage()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to create category'
  } finally {
    submitting.value = false
  }
}

function startRename(id: string, current: string): void {
  renamingId.value = id
  renameDraft.value = current
}

function cancelRename(): void {
  renamingId.value = null
  renameDraft.value = ''
}

async function commitRename(id: string): Promise<void> {
  const trimmed = renameDraft.value.trim()
  if (trimmed === '') return
  await store.rename(id, trimmed)
  cancelRename()
}

async function onDelete(id: string, label: string): Promise<void> {
  const u = usage.value[id]
  if (u && u.total > 0) return // shouldn't reach here — button is disabled
  if (!confirm(`Delete category "${label}"? This cannot be undone.`)) return
  try {
    await store.remove(id)
    await refreshUsage()
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to delete category')
  }
}

/**
 * Reassign-link target: navigate to Intentions filtered by this category.
 * Uses query param `?category=<id>` consumed by IntentionsView's filter.
 */
function reassignLinkFor(id: string): void {
  router.push({ name: 'intentions', query: { category: id } })
}
</script>

<template>
  <div class="max-w-3xl mx-auto w-full px-6 py-8">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-bold">Categories</h2>
        <p class="text-sm text-slate-500 mt-1">
          Single-pick controlled vocabulary. Pinned to commitments, intentions,
          and market entries.
        </p>
      </div>
    </div>

    <!-- Add new -->
    <form class="card mb-6" @submit="onCreate">
      <h3 class="font-semibold mb-3">Add category</h3>
      <div class="flex flex-wrap gap-2">
        <input
          v-model="newLabel"
          type="text"
          class="input flex-1 min-w-[200px]"
          placeholder="e.g. Home improvement"
          :disabled="submitting"
        />
        <button class="btn-primary" type="submit" :disabled="submitting">
          {{ submitting ? 'Adding…' : 'Add' }}
        </button>
      </div>
      <p
        v-if="formError"
        class="text-xs text-rose-300 mt-2"
      >
        {{ formError }}
      </p>
    </form>

    <!-- List -->
    <EmptyState
      v-if="store.categories.length === 0"
      title="No categories"
      description="Built-in categories should be seeded automatically. Try Settings → Load sample data to reseed."
    />

    <div v-else class="card">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
            <th class="pb-2 pr-4 font-medium">Label</th>
            <th class="pb-2 pr-4 font-medium text-right">Usage</th>
            <th class="pb-2 pr-4 font-medium">Updated</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="c in store.categories" :key="c.id">
            <td class="py-3 pr-4">
              <div v-if="renamingId === c.id" class="flex gap-2">
                <input
                  v-model="renameDraft"
                  type="text"
                  class="input !py-1 text-sm"
                  @keyup.enter="commitRename(c.id)"
                  @keyup.escape="cancelRename"
                />
                <button
                  class="btn-ghost !px-2 !py-1 !text-xs"
                  type="button"
                  @click="commitRename(c.id)"
                >
                  Save
                </button>
                <button
                  class="btn-ghost !px-2 !py-1 !text-xs"
                  type="button"
                  @click="cancelRename"
                >
                  Cancel
                </button>
              </div>
              <div v-else class="flex items-center gap-2">
                <span class="font-medium">{{ c.label }}</span>
                <span
                  v-if="store.isBuiltIn(c.id)"
                  class="text-[10px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1"
                  title="Built-in category"
                >built-in</span>
              </div>
            </td>
            <td class="py-3 pr-4 text-right tabular-nums">
              <span v-if="!usage[c.id]" class="text-slate-500">…</span>
              <button
                v-else-if="usage[c.id]!.total > 0"
                class="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline text-xs"
                type="button"
                :title="`commitments: ${usage[c.id]!.commitments} · intentions: ${usage[c.id]!.intentions} · market entries: ${usage[c.id]!.marketEntries}`"
                @click="reassignLinkFor(c.id)"
              >
                {{ usage[c.id]!.total }} in use
              </button>
              <span v-else class="text-slate-500 text-xs">0</span>
            </td>
            <td class="py-3 pr-4 text-slate-500 text-xs">{{ formatDate(c.updatedAt) }}</td>
            <td class="py-3 text-right">
              <div class="flex justify-end gap-1">
                <button
                  v-if="renamingId !== c.id"
                  class="btn-ghost !px-2 !py-1 !text-xs"
                  type="button"
                  @click="startRename(c.id, c.label)"
                >
                  Rename
                </button>
                <button
                  v-if="!store.isBuiltIn(c.id)"
                  class="btn-ghost !px-2 !py-1 !text-xs hover:!bg-rose-900/40 hover:text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:!bg-transparent disabled:hover:text-slate-400"
                  type="button"
                  :disabled="!usage[c.id] || usage[c.id]!.total > 0"
                  :title="
                    !usage[c.id]
                      ? 'Loading usage…'
                      : usage[c.id]!.total > 0
                        ? `In use by ${usage[c.id]!.total} record(s) — reassign first`
                        : 'Delete this category'
                  "
                  @click="onDelete(c.id, c.label)"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="text-xs text-slate-500 mt-4">
        Built-in categories cannot be deleted (they may be renamed). User
        categories can only be deleted when nothing references them — click
        the usage count to find and reassign affected records.
      </p>
    </div>
  </div>
</template>
