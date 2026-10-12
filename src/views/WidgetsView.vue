<script setup lang="ts">
// STUB (2026-10-11): page 3 of the pager, between Dashboard and Settings (D-18). No widget table, schema or sync yet —
// those come from the widgets design session (D-53, HW-WIDGETS.md). CreateWidget is inert until then.
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 pt-8">
    <h2 class="text-xl font-bold">Widgets</h2>
    <p class="text-sm text-slate-500 mt-1">All widgets, activated or not, will list here.</p>
    <div class="card mt-6 text-center">
      <p class="text-sm text-slate-400">No widgets yet.</p>
      <button type="button" class="btn-ghost mt-4" data-test="create-widget" aria-label="Create widget" disabled>
        Create widget
      </button>
    </div>
  </div>
</template>
