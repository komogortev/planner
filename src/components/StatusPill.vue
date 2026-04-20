<script setup lang="ts">
import { computed } from 'vue'
import type { IntentionStatus } from '@/db/schema'

const props = defineProps<{
  status: IntentionStatus
}>()

const classes = computed(() => {
  switch (props.status) {
    case 'considering':
      return 'bg-slate-700 text-slate-200'
    case 'researching':
      return 'bg-indigo-600/30 text-indigo-300 ring-1 ring-indigo-600/40'
    case 'committed':
      return 'bg-amber-600/30 text-amber-300 ring-1 ring-amber-600/40'
    case 'acquired':
      return 'bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-600/40'
    case 'dropped':
      return 'bg-rose-600/30 text-rose-300 ring-1 ring-rose-600/40'
    default:
      return 'bg-slate-700 text-slate-200'
  }
})
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
    :class="classes"
  >
    {{ status }}
  </span>
</template>
