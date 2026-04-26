<script setup lang="ts">
import { computed } from 'vue'
import type { SnapshotCounts } from '@/db/snapshot'
import { totalRecords } from '@/db/snapshot'

const props = defineProps<{
  remoteCounts: SnapshotCounts
  localCounts: SnapshotCounts
  lastSyncedAt: string | null
  inFlight: boolean
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const isPopulated = computed(() => totalRecords(props.localCounts) > 0)

const lastSyncedText = computed(() =>
  props.lastSyncedAt
    ? new Date(props.lastSyncedAt).toLocaleString()
    : 'Never',
)

const rows = computed(() =>
  (
    [
      ['Commitments', 'commitments'],
      ['Payments', 'payments'],
      ['Intentions', 'intentions'],
      ['Market entries', 'marketEntries'],
    ] as const
  ).map(([label, key]) => ({
    label,
    local: props.localCounts[key],
    remote: props.remoteCounts[key],
    delta: props.remoteCounts[key] - props.localCounts[key],
  })),
)

function onBackdrop() {
  if (!props.inFlight) emit('cancel')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4"
    @click.self="onBackdrop"
  >
    <div class="card max-w-md w-full space-y-4">
      <header>
        <h3 class="text-lg font-bold">
          {{ isPopulated ? 'Replace local data with GitHub snapshot' : 'Populate local data from GitHub' }}
        </h3>
        <p class="text-xs text-slate-500 mt-1">Last synced: {{ lastSyncedText }}</p>
      </header>

      <div
        v-if="isPopulated"
        class="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
      >
        ⚠ Local-only records will be lost. This is destructive — local data is
        replaced entirely with the GitHub snapshot.
      </div>

      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wider text-slate-500">
            <th class="text-left font-semibold pb-1">Table</th>
            <th class="text-right font-semibold pb-1">Local</th>
            <th class="text-right font-semibold pb-1">Remote</th>
            <th class="text-right font-semibold pb-1">Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.label" class="border-t border-slate-800">
            <td class="py-1.5">{{ row.label }}</td>
            <td class="py-1.5 text-right font-mono">{{ row.local }}</td>
            <td class="py-1.5 text-right font-mono">{{ row.remote }}</td>
            <td
              class="py-1.5 text-right font-mono"
              :class="{
                'text-emerald-400': row.delta > 0,
                'text-rose-400': row.delta < 0,
                'text-slate-500': row.delta === 0,
              }"
            >
              {{ row.delta > 0 ? `+${row.delta}` : row.delta }}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="flex justify-end gap-2 pt-2">
        <button class="btn-ghost" :disabled="inFlight" @click="emit('cancel')">
          Cancel
        </button>
        <button
          :class="isPopulated ? 'btn-danger' : 'btn-primary'"
          :disabled="inFlight"
          @click="emit('confirm')"
        >
          {{ inFlight ? 'Restoring…' : isPopulated ? 'Replace local data' : 'Populate' }}
        </button>
      </div>
    </div>
  </div>
</template>
