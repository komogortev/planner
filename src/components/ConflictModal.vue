<script setup lang="ts">
import { computed } from 'vue'
import type { PendingConflict } from '@/stores/sync'
import type { SnapshotCounts } from '@/db/snapshot'
import { CURRENT_SCHEMA_VERSION } from '@/db/snapshot'

const props = defineProps<{
  conflict: PendingConflict
  localCounts: SnapshotCounts
  lastSyncedAt: string | null
  inFlight: boolean
}>()

const emit = defineEmits<{
  cancel: []
  'pull-remote': []
  'overwrite-remote': []
}>()

const remoteCounts = computed(() => props.conflict.remoteSnapshot.recordCounts)

const remoteIsOlderSchema = computed(
  () => props.conflict.remoteSnapshot.schemaVersion < CURRENT_SCHEMA_VERSION,
)

const rows = computed(() =>
  (
    [
      ['Commitments', 'commitments'],
      ['Payments', 'payments'],
      ['Intentions', 'intentions'],
      ['Market entries', 'marketEntries'],
      ['Categories', 'categories'],
      ['Themes', 'themes'],
      ['Theme members', 'themeMembers'],
    ] as const
  ).map(([label, key]) => ({
    label,
    // Older-schema remotes don't have these counts; fall back to 0 for display.
    local: props.localCounts[key] ?? 0,
    remote: remoteCounts.value[key] ?? 0,
    delta: (remoteCounts.value[key] ?? 0) - (props.localCounts[key] ?? 0),
  })),
)

const remoteExportedAt = computed(() =>
  new Date(props.conflict.remoteSnapshot.exportedAt).toLocaleString(),
)

const lastSyncedText = computed(() =>
  props.lastSyncedAt ? new Date(props.lastSyncedAt).toLocaleString() : 'Never',
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
        <h3 class="text-lg font-bold">Sync conflict</h3>
        <p class="text-sm text-slate-400 mt-1">
          Remote was updated since your last sync.
        </p>
      </header>

      <div
        v-if="remoteIsOlderSchema"
        class="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
      >
        Remote snapshot is from an older app version (schemaVersion
        {{ conflict.remoteSnapshot.schemaVersion }} &lt; {{ CURRENT_SCHEMA_VERSION }}).
        Recommend <strong>Pull remote first</strong> to migrate it forward —
        Overwrite will replace the older snapshot with your current data and
        any other v1 device's data not yet pulled here will be lost.
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Last sync from this device</dt>
          <dd class="mt-0.5">{{ lastSyncedText }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Remote update</dt>
          <dd class="mt-0.5">{{ remoteExportedAt }}</dd>
          <dd class="text-xs text-slate-500">from {{ conflict.remoteSnapshot.deviceId }}</dd>
        </div>
      </dl>

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

      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <button class="btn-ghost" :disabled="inFlight" @click="emit('cancel')">
          Cancel
        </button>
        <button
          :class="remoteIsOlderSchema ? 'btn-primary' : 'btn-ghost'"
          :disabled="inFlight"
          @click="emit('pull-remote')"
        >
          {{ inFlight ? 'Working…' : 'Pull remote first' }}
        </button>
        <button class="btn-danger" :disabled="inFlight" @click="emit('overwrite-remote')">
          {{ inFlight ? 'Working…' : 'Overwrite remote' }}
        </button>
      </div>
    </div>
  </div>
</template>
