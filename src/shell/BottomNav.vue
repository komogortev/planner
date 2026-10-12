<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PAGES, pageIndex } from './pages'

// Hidden by default (note 11): touching the strip just above the system gesture inset slides the bar in.
// It hides again on navigation, on a tap outside, or after a few idle seconds.
const open = ref(false)
const route = useRoute()
let timer: number | undefined
// The tap that reveals the bar must not also choose a page: the bar slides in under the same finger, and the click that
// ends that tap would land on a link (calibration 2026-10-12: it read as an unwanted swipe to the next page). A reveal by
// touch swallows the next click on the bar, however long the finger stayed; a new touch on the bar is a real tap.
let swallow = false

function show(e?: Event): void {
  if (!open.value && e?.type === 'touchstart') swallow = true
  open.value = true
  window.clearTimeout(timer)
  timer = window.setTimeout(hide, 4000)
}
function hide(): void {
  swallow = false
  open.value = false
  window.clearTimeout(timer)
}
// A new touch on the bar is a real tap: it ends the swallow.
function onNavPointerDown(): void {
  swallow = false
}
// The overlay behind the open bar: the revealing tap's click can land on it while the bar slides in — not a tap outside.
function onOverlayClick(): void {
  if (swallow) swallow = false
  else hide()
}
function guardClick(e: MouseEvent): void {
  if (!swallow) return
  swallow = false
  e.preventDefault() // the browser's own link navigation
  e.stopPropagation() // capture phase on <nav>: RouterLink's handler never runs
}
watch(() => route.path, hide)
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <!-- Reveal zone: the bottom zone (--nav-zone), which page content never scrolls into; touch or tap reveals. -->
  <div
    v-if="!open"
    class="reveal-zone"
    data-test="nav-reveal"
    @touchstart.passive="show"
    @click="show"
  >
    <span class="dots" role="img" :aria-label="`Page ${pageIndex(route.path) + 1} of ${PAGES.length}`">
      <template v-for="(p, i) in PAGES" :key="p.to">
        <!-- The first page is capture (Home, the dictophone), so its dot is a microphone of the same visual weight: an
             outline like the other dots' rings, filled with the theme's ink while it is the current page. -->
        <svg
          v-if="i === 0"
          class="mic"
          :class="{ 'mic-active': i === pageIndex(route.path) }"
          data-test="nav-mic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </svg>
        <span v-else class="dot" :class="{ 'dot-active': i === pageIndex(route.path) }" />
      </template>
    </span>
  </div>
  <div v-else class="fixed inset-0 z-30" @touchstart.passive="hide" @click="onOverlayClick" />
  <nav class="bottom-nav" :class="{ 'bottom-nav-open': open }" aria-label="Pages" @pointerdown="onNavPointerDown" @click.capture="guardClick">
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
  bottom: 0;
  height: var(--nav-zone); /* calibration 2026-10-12: was 12dvh over the content; now its own band */
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-bottom: env(safe-area-inset-bottom); /* dots centred in the band, above the system gesture bar */
}
.dots {
  display: flex;
  align-items: center; /* the mic is taller than the rings: centre them on one line */
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
.mic {
  /* 14px tall against the dots' 9px: a glyph needs more room than a ring to read; its capsule is ~6px wide, the same
     visual weight. Colours follow the dots: the ring colour at rest, the theme ink and glow when current. */
  width: 14px;
  height: 14px;
  align-self: center;
  color: rgb(var(--s-200) / 0.65);
  transition: color 120ms, filter 120ms;
}
.mic-active {
  color: rgb(var(--s-100));
  filter: drop-shadow(0 0 3px rgb(var(--s-100) / 0.35));
}
.mic-active rect {
  fill: currentColor; /* the capsule fills like the active dot; the cradle and stem stay lines */
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
  height: var(--nav-zone); /* the same band as the reveal zone */
  padding: 4px 12px calc(4px + env(safe-area-inset-bottom));
  background: rgb(var(--s-900));
  border-top: 1px solid rgb(var(--s-700));
  transform: translateY(100%);
  transition: transform 160ms ease-out;
}
.bottom-nav-open {
  transform: translateY(0);
}
</style>
