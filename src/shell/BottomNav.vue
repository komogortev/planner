<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PAGES, pageIndex } from './pages'

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
    <span class="dots" role="img" :aria-label="`Page ${pageIndex(route.path) + 1} of ${PAGES.length}`">
      <span
        v-for="(p, i) in PAGES"
        :key="p.to"
        class="dot"
        :class="{ 'dot-active': i === pageIndex(route.path) }"
      />
    </span>
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
  padding-bottom: 30px; /* dots ride above the system gesture bar and the version badge */
}
.dots {
  display: flex;
  gap: 10px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid rgb(var(--s-200) / 0.65); /* s-200 is the light ink in dark theme and the dark ink in light: visible on both backdrops */
  transition: background-color 120ms, border-color 120ms;
}
.dot-active {
  background: rgb(var(--s-100)); /* the theme's ink: cream on dark, deep navy-teal on light */
  border-color: rgb(var(--s-100));
  box-shadow: 0 0 6px rgb(var(--s-100) / 0.35);
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
  background: rgb(var(--s-900));
  border-top: 1px solid rgb(var(--s-700));
  transform: translateY(100%);
  transition: transform 160ms ease-out;
}
.bottom-nav-open {
  transform: translateY(0);
}
</style>
