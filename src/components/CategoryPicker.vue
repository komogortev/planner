<script setup lang="ts">
import { computed } from 'vue'
import { useCategoriesStore } from '@/stores/categories'

/**
 * CategoryPicker — single-select dropdown of categories.
 *
 * Two-way binds via v-model to a `string | null` (categoryId or null for
 * uncategorized). Used in entity forms (Commitment / Intention / MarketEntry).
 *
 * Built-ins are listed first, then user categories, both already sorted by
 * the store. The empty option ("Uncategorized") binds to null.
 */
const props = defineProps<{
  modelValue: string | null
  /** Optional id for label-for binding. */
  id?: string
  required?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [string | null]
}>()

const categories = useCategoriesStore()

const value = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => emit('update:modelValue', v === '' ? null : v),
})
</script>

<template>
  <select :id="id" v-model="value" class="input" :required="required">
    <option value="">— Uncategorized —</option>
    <option
      v-for="c in categories.categories"
      :key="c.id"
      :value="c.id"
    >
      {{ c.label }}
    </option>
  </select>
</template>
