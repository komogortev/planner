<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <div
    class="rounded-2xl border-2 border-dashed border-slate-800 p-10 text-center"
  >
    <h3 class="text-base font-semibold text-slate-300">{{ title }}</h3>
    <p v-if="description" class="text-sm text-slate-500 mt-1">
      {{ description }}
    </p>
    <div class="mt-5">
      <slot />
    </div>
  </div>
</template>
