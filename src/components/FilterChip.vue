<script setup lang="ts">
import { computed } from 'vue'

/**
 * FilterChip — compact dropdown filter for list-view headers.
 *
 * Two-way binds via v-model to a `string | null` representing the selected
 * option's value (null = "all"). Generic over option shape — caller passes
 * a list of `{ value, label }`.
 *
 * Visual: shows a chip-like select. Active state (a non-null value) gets a
 * subtle indigo border to indicate the list is filtered.
 */
export interface FilterOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string | null
  options: FilterOption[]
  /** Label shown when nothing is selected. */
  allLabel?: string
  /** Title attribute (tooltip) for accessibility / hover. */
  title?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string | null]
}>()

const value = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => emit('update:modelValue', v === '' ? null : v),
})

const isActive = computed(() => props.modelValue !== null && props.modelValue !== '')
</script>

<template>
  <select
    v-model="value"
    :title="title"
    class="rounded-md bg-slate-900/70 border px-2 py-1 text-xs text-slate-300 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    :class="[
      isActive
        ? 'border-indigo-500/60 text-indigo-200'
        : 'border-slate-800',
    ]"
  >
    <option value="">{{ allLabel ?? 'All' }}</option>
    <option v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>
</template>
