<script setup lang="ts">
import { ref } from 'vue'
import { setWidgetActive, useWidgets } from '@/widgets/useWidgets'
import type { SystemWidgetId } from '@/widgets/system'

// Page 3 of the pager (D-18): every widget, on the Dashboard or not (D-107…D-110). The system widgets are listed with a
// switch; activation is per account (a `widget` record, synced). Custom widgets (D-111) come later: Create stays inert.
const { widgets, loaded } = useWidgets()
const busy = ref<string | null>(null)
const error = ref<string | null>(null)

async function toggle(id: SystemWidgetId, active: boolean) {
  if (busy.value) return
  busy.value = id
  error.value = null
  const r = await setWidgetActive(id, active)
  if (!r.ok) error.value = `Could not save: ${r.error}`
  busy.value = null
}
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 pt-8">
    <h2 class="text-xl font-bold">Widgets</h2>
    <p class="text-sm text-slate-300 mt-1">Switch a widget on to show it on the Dashboard, on every device you use.</p>
    <ul class="mt-6 flex flex-col gap-3" data-test="widget-list">
      <li v-for="w in widgets" :key="w.id" class="card row" :data-test="`widget-${w.id}`">
        <div class="min-w-0">
          <h3 class="font-semibold">{{ w.name }} <span v-if="!w.active && !w.defaultActive" class="sub">suggested</span></h3>
          <p class="sub mt-1">{{ w.description }}</p>
        </div>
        <button
          type="button" role="switch" class="switch" :class="{ 'switch-on': w.active }" :aria-checked="w.active" :aria-label="`Show ${w.name} on the Dashboard`"
          :disabled="!loaded || busy !== null" :data-test="`widget-toggle-${w.id}`" @click="toggle(w.id, !w.active)"
        >
          <span class="knob" />
        </button>
      </li>
    </ul>
    <p v-if="error" class="sub warn mt-3" role="alert" data-test="widget-error">{{ error }}</p>
    <div class="card mt-6 text-center">
      <p class="text-sm text-slate-400">Your own widgets come later.</p>
      <button type="button" class="btn-ghost mt-4" data-test="create-widget" aria-label="Create widget" disabled>
        Create widget
      </button>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: var(--glass-text); }
.sub { font-size: 0.78rem; color: var(--glass-sub); font-weight: 400; }
.warn { color: var(--glass-warn); }
.switch { flex: none; width: 2.75rem; height: 1.6rem; border-radius: 999px; background: var(--glass-sub); opacity: 0.55; position: relative; transition: background 0.15s, opacity 0.15s; }
.switch-on { background: #4f46e5; opacity: 1; /* indigo-600, as .btn-primary */ }
.switch:disabled { cursor: wait; }
.knob { position: absolute; top: 0.2rem; left: 0.2rem; width: 1.2rem; height: 1.2rem; border-radius: 999px; background: #fff; transition: transform 0.15s; }
.switch-on .knob { transform: translateX(1.15rem); }
@media (prefers-reduced-motion: reduce) { .switch, .knob { transition: none; } }
</style>
