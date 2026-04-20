<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearAllData, getDbStats, seedSampleData } from '@/db/seed'
import { useOnline } from '@/composables/useOnline'

const online = useOnline()
const stats = ref<{ commitments: number; payments: number; intentions: number; marketEntries: number }>(
  { commitments: 0, payments: 0, intentions: 0, marketEntries: 0 },
)

async function refreshStats(): Promise<void> {
  stats.value = await getDbStats()
}

async function doSeed(): Promise<void> {
  if (!confirm('Replace all current data with sample data?')) return
  await seedSampleData()
  await refreshStats()
}

async function doClear(): Promise<void> {
  if (!confirm('Permanently delete ALL planner data?')) return
  await clearAllData()
  await refreshStats()
}

onMounted(refreshStats)
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 py-8 space-y-6">
    <header>
      <h2 class="text-2xl font-bold">Settings</h2>
      <p class="text-sm text-slate-500 mt-1">
        App info, data tools, future sync options.
      </p>
    </header>

    <section class="card">
      <h3 class="font-semibold mb-4">App info</h3>
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Version</dt>
          <dd class="mt-1">0.1.0 (L0 POC)</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Storage</dt>
          <dd class="mt-1">IndexedDB (local only)</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Connection</dt>
          <dd class="mt-1">{{ online ? 'Online' : 'Offline' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Sync</dt>
          <dd class="mt-1 text-slate-400">Deferred to L1</dd>
        </div>
      </dl>
    </section>

    <section class="card">
      <h3 class="font-semibold mb-4">Database</h3>
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-6">
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Commitments</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.commitments }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Payments</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.payments }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Intentions</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.intentions }}</dd>
        </div>
        <div>
          <dt class="text-xs text-slate-500 uppercase tracking-wider">Market entries</dt>
          <dd class="mt-1 text-lg font-semibold">{{ stats.marketEntries }}</dd>
        </div>
      </dl>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost" @click="refreshStats">Refresh stats</button>
        <button class="btn-ghost" @click="doSeed">Load sample data</button>
        <button class="btn-danger" @click="doClear">Clear all data</button>
      </div>
    </section>

    <section class="card">
      <h3 class="font-semibold mb-2">Planned (L1)</h3>
      <ul class="text-sm text-slate-400 list-disc list-inside space-y-1">
        <li>Google Sheets bidirectional sync</li>
        <li>JSON export / import</li>
        <li>Payment due reminders (Web Push)</li>
        <li>Cross-entity relations (commitment ↔ intention)</li>
      </ul>
    </section>
  </div>
</template>
