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
  padding: 10px 10px 0;
}
/* The page itself: a sheet of darker wool hovering over the backdrop. */
.sheet {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 22px 22px 0 0;
  background-color: var(--sheet-bg);
  background-image: repeating-linear-gradient(45deg, var(--twill) 0 1px, transparent 1px 3px);
  border: 1px solid var(--sheet-edge);
  box-shadow: var(--sheet-shadow), inset 0 1px 0 var(--sheet-edge);
}
@media (prefers-reduced-motion: reduce) {
  .track {
    transition-duration: 1ms;
  }
}
</style>
