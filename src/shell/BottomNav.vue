<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PAGES } from './pages'

// Hidden by default (note 11): touching the strip just above the system gesture inset slides the bar in.
// It hides again on navigation, on a tap outside, or after a few idle seconds.
const open = ref(false)
const route = useRoute()
let timer: number | undefined

function show(): void {
  open.value = true
  window.clearTimeout(timer)
  timer = window.setTimeout(() => (open.value = false), 4000)
}
function hide(): void {
  open.value = false
  window.clearTimeout(timer)
}
watch(() => route.path, hide)
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <!-- Reveal zone: starts above the system inset and spans 12% of the screen height; touch or tap reveals. -->
  <div
    v-if="!open"
    class="reveal-zone"
    data-test="nav-reveal"
    @touchstart.passive="show"
    @click="show"
  >
    <span class="reveal-handle" />
  </div>
  <div v-else class="fixed inset-0 z-30" @touchstart.passive="hide" @click="hide" />
  <nav class="bottom-nav" :class="{ 'bottom-nav-open': open }" aria-label="Pages">
    <RouterLink
      v-for="p in PAGES"
      :key="p.to"
      :to="p.to"
      class="nav-link flex-1 flex items-center justify-center"
      :class="{ 'nav-link-active': route.path === p.to }"
    >
      {{ p.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.reveal-zone {
  position: fixed;
  left: 0;
  right: 0;
  bottom: env(safe-area-inset-bottom);
  height: 12dvh; /* owner 2026-10-10: 10-15% of the screen height */
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding-bottom: 14px; /* handle rides above the system gesture bar */
}
.reveal-handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgb(148 163 184 / 0.35);
}
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: stretch;
  gap: 4px;
  height: calc(12dvh + env(safe-area-inset-bottom)); /* same 12% as the reveal zone */
  padding: 8px 12px env(safe-area-inset-bottom);
  background: rgb(2 6 23);
  border-top: 1px solid rgb(30 41 59);
  transform: translateY(100%);
  transition: transform 160ms ease-out;
}
.bottom-nav-open {
  transform: translateY(0);
}
</style>
