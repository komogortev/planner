<script setup lang="ts">
import { useOnline } from '@/composables/useOnline'

const online = useOnline()
</script>

<template>
  <div
    class="flex items-center gap-2 text-xs font-medium"
    :title="online ? 'Online' : 'Offline — changes saved locally'"
  >
    <span
      class="w-2 h-2 rounded-full transition-colors"
      :class="online ? 'bg-emerald-500' : 'bg-amber-500'"
      aria-hidden="true"
    />
    <span class="text-slate-400 hidden sm:inline">
      {{ online ? 'Online' : 'Offline' }}
    </span>
  </div>
</template>
