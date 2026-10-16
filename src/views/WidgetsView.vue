<script setup lang="ts">
import { ref } from 'vue'
import { setProjectActive, setWidgetActive, useWidgets } from '@/widgets/useWidgets'
import CardMenu from '@/widgets/CardMenu.vue'
import { cardTint } from '@/widgets/tints'
import type { ProjectWidget } from '@/widgets/projects'
import type { SystemWidgetId } from '@/widgets/system'

// Page 3 of the pager (D-18): every widget, on the Dashboard or not (D-107…D-110). The system widgets are listed with a
// switch; activation is per account (a `widget` record, synced). Custom widgets (D-111) come later. G13 (owner, 2026-10-14:
// the page read as construction / templates): each row is laid out like its live card — the Dashboard's width and gutter, a
// header line with the name and the controls, the description below it — and the inert Create placeholder is a plain line.
const { widgets, loaded, projects, tintOf } = useWidgets()
const busy = ref<string | null>(null)
const error = ref<string | null>(null)

async function toggleProject(p: ProjectWidget) {
  if (busy.value) return
  busy.value = p.id
  error.value = null
  try {
    const r = await setProjectActive(p.repo, p.private, !p.active)
    if (!r.ok) error.value = `Could not save: ${r.error}`
  } catch (err) {
    error.value = `Could not save: ${String(err)}`
  } finally {
    busy.value = null
  }
}

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
  <div class="max-w-2xl mx-auto w-full px-4 pt-4">
    <h2 class="text-lg font-semibold px-1">Widgets</h2>
    <p class="text-sm text-slate-300 mt-0.5 px-1">Switch one on to show it on the Dashboard, on every device you use.</p>
    <ul class="mt-4 flex flex-col gap-3" data-test="widget-list">
      <li v-for="w in widgets" :key="w.id" class="card w" v-bind="cardTint(tintOf(w.id))" :data-test="`widget-${w.id}`">
        <header class="head">
          <h3 class="font-semibold min-w-0">{{ w.name }} <span v-if="!w.active && !w.defaultActive" class="sub">suggested</span></h3>
          <div class="controls">
        <CardMenu :widget-id="w.id" :label="`${w.name} options`" />
        <button
          type="button" role="switch" class="switch" :class="{ 'switch-on': w.active }" :aria-checked="w.active" :aria-label="`Show ${w.name} on the Dashboard`"
          :disabled="!loaded || busy !== null" :data-test="`widget-toggle-${w.id}`" @click="toggle(w.id, !w.active)"
        >
          <span class="knob" />
        </button>
          </div>
        </header>
        <p class="desc">{{ w.description }}</p>
      </li>
      <li v-for="p in projects" :key="p.id" class="card w" v-bind="cardTint(tintOf(p.id))" :data-test="`widget-project-${p.repo}`">
        <header class="head">
          <h3 class="font-semibold truncate min-w-0">{{ p.repo }} <span class="sub">project</span></h3>
          <div class="controls">
        <CardMenu :widget-id="p.id" :label="`${p.repo} options`" />
        <button
          type="button" role="switch" class="switch" :class="{ 'switch-on': p.active }" :aria-checked="p.active" :aria-label="`Show ${p.repo} on the Dashboard`"
          :disabled="!loaded || busy !== null" :data-test="`widget-toggle-project-${p.repo}`" @click="toggleProject(p)"
        >
          <span class="knob" />
        </button>
          </div>
        </header>
        <p class="desc">Its STATE snapshot and recent merges, read from GitHub. Add or remove projects in Settings → Integrations.</p>
      </li>
    </ul>
    <p v-if="error" class="sub warn mt-3" role="alert" data-test="widget-error">{{ error }}</p>
    <p class="text-slate-300 text-sm mt-4 px-1" data-test="create-widget-later">Your own widgets come later.</p>
  </div>
</template>

<style scoped>
.w { color: var(--glass-text); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.desc { font-size: 0.85rem; color: var(--glass-sub); margin-top: 0.75rem; } /* below the switch's widened tap area (11px) */
.controls { flex: none; display: flex; align-items: center; gap: 0.5rem; }
.sub { font-size: 0.78rem; color: var(--glass-sub); font-weight: 400; }
.warn { color: var(--glass-warn); }
.switch { flex: none; width: 2.75rem; height: 1.6rem; border-radius: 999px; background: var(--glass-sub); opacity: 0.55; position: relative; transition: background 0.15s, opacity 0.15s; }
.switch-on { background: #4f46e5; opacity: 1; /* indigo-600, as .btn-primary */ }
.switch:disabled { cursor: wait; }
/* The touch target is 48x48 around the 44x26 switch (missed taps reported on the phone, owner 2026-10-14). */
.switch::before { content: ''; position: absolute; inset: -11px -2px; }
.knob { position: absolute; top: 0.2rem; left: 0.2rem; width: 1.2rem; height: 1.2rem; border-radius: 999px; background: #fff; transition: transform 0.15s; }
.switch-on .knob { transform: translateX(1.15rem); }
@media (prefers-reduced-motion: reduce) { .switch, .knob { transition: none; } }
</style>
