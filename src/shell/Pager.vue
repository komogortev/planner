<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import DashboardView from '@/views/DashboardView.vue'
import SettingsView from '@/views/SettingsView.vue'
import { PAGES, dragOffset, pageIndex, settle } from './pages'

// The three main pages sit side by side on one track. The track follows the finger while dragging and eases to the
// settled page on release, so the next page pushes the current one away (native page-swap feel). The route is the
// source of truth: a nav-bar tap and a swipe both end in router.push, and the track animates to the new index.
const route = useRoute()
const router = useRouter()
const index = computed(() => Math.max(0, pageIndex(route.path)))

const dragPx = ref(0)
const dragging = ref(false)
let start: { x: number; y: number; t: number; axis: 'x' | 'y' | null } | null = null
let width = 1

function ignore(el: EventTarget | null): boolean {
  // Typing and text selection keep their own horizontal drag.
  return el instanceof HTMLElement && !!el.closest('textarea, input, select')
}

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  if (!t || ignore(e.target)) return
  start = { x: t.clientX, y: t.clientY, t: performance.now(), axis: null }
  width = (e.currentTarget as HTMLElement).clientWidth || 1
}

function onTouchMove(e: TouchEvent): void {
  const t = e.touches[0]
  if (!start || !t) return
  const dx = t.clientX - start.x
  const dy = t.clientY - start.y
  if (!start.axis) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    start.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    dragging.value = start.axis === 'x'
  }
  if (start.axis === 'x') dragPx.value = dragOffset(index.value, dx)
}

function onTouchEnd(e: TouchEvent): void {
  const t = e.changedTouches[0]
  const s = start
  start = null
  if (!s || !t || s.axis !== 'x') {
    dragging.value = false
    return
  }
  const dx = t.clientX - s.x
  const vx = dx / Math.max(1, performance.now() - s.t)
  const target = settle(index.value, dx, vx, width)
  dragging.value = false // re-enables the easing; the transform now animates to the settled position
  dragPx.value = 0
  if (target !== index.value) void router.push(PAGES[target]!.to)
}

const trackStyle = computed(() => ({
  transform: `translate3d(calc(${-index.value * 100}% + ${dragPx.value}px), 0, 0)`,
}))
</script>

<template>
  <div
    class="pager"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
    @touchcancel.passive="onTouchEnd"
  >
    <div class="track" :class="{ 'track-dragging': dragging }" :style="trackStyle">
      <!-- inert: an off-screen page is neither focusable nor read by a screen reader. -->
      <section class="slot" :inert="index !== 0"><div class="sheet"><HomeView /></div></section>
      <section class="slot" :inert="index !== 1"><div class="sheet"><DashboardView /></div></section>
      <section class="slot" :inert="index !== 2"><div class="sheet"><SettingsView /></div></section>
    </div>
  </div>
</template>

<style scoped>
.pager {
  height: 100%;
  overflow: hidden;
  touch-action: pan-y; /* the browser keeps vertical scroll; horizontal drags are ours */
}
.track {
  display: flex;
  height: 100%;
  transition: transform 320ms cubic-bezier(0.22, 0.85, 0.28, 1);
  will-change: transform;
}
.track-dragging {
  transition: none;
}
.slot {
  flex: 0 0 100%;
  min-width: 0;
  height: 100%;
}
/* No panel: page content floats straight on the textured backdrop and casts its own shadow (the dictophone's
   drop-shadow, the cards' box-shadow in style.css). The sheet is only the page's own scroll container. */
.sheet {
  position: relative;
  height: calc(100% + 80px); /* the page's own 100% plus the 24px above and 56px below it */
  overflow-x: hidden; /* never a horizontal scroller: horizontal drags are the pager's */
  overflow-y: auto; /* a scroll box clips on both axes, so it is made wider/taller than the page: */
  overscroll-behavior: none; /* no edge glow / scroll chaining from the page */
  /* touch-action does not inherit past a scroll container, so the pager's pan-y has to be restated here; without it
     the browser treats a horizontal drag on the page as its own scroll and fights the pager for the gesture. */
  touch-action: pan-y;
  /* ...the page keeps its layout (negative margin = padding), but shadows get 56px of room on every side, spilling
     into the neighbouring page when they fall that way. Only the screen edge itself (.pager) cuts them. */
  margin: -24px -56px -56px;
  padding: 24px 56px 56px;
}
@media (prefers-reduced-motion: reduce) {
  .track {
    transition-duration: 1ms;
  }
}
</style>
