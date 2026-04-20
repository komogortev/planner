<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    values: number[]
    width?: number
    height?: number
  }>(),
  {
    width: 120,
    height: 32,
  },
)

const path = computed(() => {
  if (props.values.length < 2) return ''
  const min = Math.min(...props.values)
  const max = Math.max(...props.values)
  const range = max - min || 1
  const step = props.width / (props.values.length - 1)
  return props.values
    .map((v, i) => {
      const x = i * step
      const y = props.height - ((v - min) / range) * props.height
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
})

const direction = computed(() => {
  if (props.values.length < 2) return 'flat'
  const first = props.values[0]!
  const last = props.values[props.values.length - 1]!
  if (last < first) return 'down'
  if (last > first) return 'up'
  return 'flat'
})

const stroke = computed(() => {
  if (direction.value === 'down') return '#10b981' // emerald — price decreased = good for buyer
  if (direction.value === 'up') return '#f43f5e' // rose — price increased = bad
  return '#64748b'
})
</script>

<template>
  <svg
    v-if="values.length >= 2"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="inline-block"
    aria-hidden="true"
  >
    <path
      :d="path"
      fill="none"
      :stroke="stroke"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
  <span v-else class="text-xs text-slate-500">—</span>
</template>
