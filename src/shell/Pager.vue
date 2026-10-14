<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import DashboardView from '@/views/DashboardView.vue'
import WidgetsView from '@/views/WidgetsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import { PAGES, PARALLAX, backdropShift, backdropWidth, dragOffset, layerShift, layerShiftCss, pageIndex, pullCss, pullTransform, settle, undersideAmount } from './pages'

// The four main pages sit side by side on one track. The track follows the finger while dragging and eases to the
// settled page on release, so the next page pushes the current one away (native page-swap feel). The route is the
// source of truth: a dot tap and a swipe both end in router.push, and the track animates to the new index.
const route = useRoute()
const router = useRouter()
const index = computed(() => Math.max(0, pageIndex(route.path)))

const dragPx = ref(0)
const pull = ref(0) // the drag as a fraction of the page width, for the cloth-pull effect
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
  if (start.axis === 'x') {
    dragPx.value = dragOffset(index.value, dx)
    pull.value = dragPx.value / width
  }
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
  pull.value = 0 // the cloth's shape relaxes back (elastic ease, see .pulled); its position stays
  if (target !== index.value) void router.push(PAGES[target]!.to)
}

/**
 * The system took the gesture away — an edge swipe, a pulled notification shade, a call. That is not a release at the last
 * finger position: it must not turn a half-finished drag into a page change. Snap back to the page the drag started on.
 */
function onTouchCancel(): void {
  start = null
  dragging.value = false
  dragPx.value = 0
  pull.value = 0
}

// The backdrop rides along at PARALLAX of the pages' distance (same easing, so it stays locked to the drag).
const backdropStyle = computed(() => {
  const { screens, px } = backdropShift(index.value, dragPx.value)
  return {
    width: `${backdropWidth() * 100}%`,
    transform: `translate3d(calc(${screens * 100}cqw + ${px}px), 0, 0)`,
  }
})

// The folds and the accent folds are pulled with the finger (stretched, squeezed, sheared, twisted, tilted — the
// accents on their own schedule, so the folds change shape relative to each other) and the *shape* springs back on
// release. Their *position* does not: it is a function of the page (`layerShift`), its own parallax layer, so it stays
// where the swipe ended. Two properties, two easings: `translate` (smooth, locked to the pages) and `transform` (spring).
const foldsStyle = computed(() => ({
  translate: layerShiftCss(layerShift(index.value, pull.value, 'folds')),
  transform: pullCss(pullTransform(pull.value, 'folds')),
}))
const accentsStyle = computed(() => ({
  translate: layerShiftCss(layerShift(index.value, pull.value, 'accents')),
  transform: pullCss(pullTransform(pull.value, 'accents')),
}))

// Settings is the cloth's underside: darker, folds mirrored, fading in across the last swipe (follows the finger).
const undersideStyle = computed(() => ({ '--u': undersideAmount(index.value, pull.value) }))

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
    @touchcancel.passive="onTouchCancel"
  >
    <div class="backdrop t-base" :class="{ 'track-dragging': dragging }" :style="backdropStyle" aria-hidden="true">
      <div class="t-folds pulled" :class="{ 'pulled-live': dragging }" :style="foldsStyle" />
      <div class="t-accents pulled" :class="{ 'pulled-live': dragging }" :style="accentsStyle" />
      <!-- The underside sits inside the backdrop so the mirrored folds blend with the cloth itself (a wrapper with its
           own opacity would isolate the blend); each layer carries the opacity on its own. -->
      <div class="underside u-tint" :class="{ 'track-dragging': dragging }" :style="undersideStyle" />
      <div class="underside u-folds" :class="{ 'track-dragging': dragging }" :style="undersideStyle" />
      <div class="t-weave" />
    </div>
    <div class="track" :class="{ 'track-dragging': dragging }" :style="trackStyle">
      <!-- inert: an off-screen page is neither focusable nor read by a screen reader. -->
      <section class="slot" :inert="index !== 0"><div class="sheet"><HomeView /></div></section>
      <section class="slot" :inert="index !== 1"><div class="sheet"><DashboardView /></div></section>
      <section class="slot" :inert="index !== 2"><div class="sheet"><WidgetsView /></div></section>
      <section class="slot" :inert="index !== 3"><div class="sheet"><SettingsView /></div></section>
    </div>
  </div>
</template>

<style scoped>
.pager {
  position: relative;
  container-type: inline-size; /* cqw = the pager's width, for the backdrop's parallax offset */
  height: 100%;
  overflow: hidden;
  touch-action: pan-y; /* the browser keeps vertical scroll; horizontal drags are ours */
}
.backdrop {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  transition: transform 320ms cubic-bezier(0.22, 0.85, 0.28, 1);
  will-change: transform;
  pointer-events: none;
}
.underside {
  position: absolute;
  pointer-events: none;
  transition: opacity 320ms cubic-bezier(0.22, 0.85, 0.28, 1); /* the pages' easing: it lands with the page */
}
.u-tint {
  inset: 0;
  opacity: var(--u);
  background: var(--underside-tint);
}
.u-folds {
  /* The same folds seen from the other side: mirrored, blended with the cloth like the front ones. */
  inset: -4% -16%;
  background: var(--folds) center / cover no-repeat;
  mix-blend-mode: var(--fold-blend);
  transform: scaleX(-1);
  opacity: calc(var(--u) * var(--underside-folds)); /* full folds lift the tone back to the front's: a light hand */
}
.pulled {
  /* The shape is springy: it overshoots a touch on release, like cloth settling back into its folds. The position
     (`translate`) rides the pages' own easing, no overshoot, and stays where the swipe ended. */
  transition:
    transform 560ms cubic-bezier(0.3, 1.45, 0.5, 1),
    translate 320ms cubic-bezier(0.22, 0.85, 0.28, 1);
  will-change: transform, translate;
}
.pulled-live {
  transition: transform 80ms linear, translate 0s; /* the shape follows the finger, lightly smoothed; the position exactly */
}
.track {
  position: relative; /* above the backdrop */
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
  /* Content stops where the bottom band begins (--nav-zone, calibration 2026-10-12): at the end of a scroll the lowest
     card at most touches the band. The box itself is made larger than the page on every side (negative margin =
     padding) so shadows fall naturally — 24px above, 56px at the sides, the band plus --shadow-room below — and only the
     screen edge (.pager) cuts them. */
  height: calc(100% + 24px + var(--shadow-room));
  overflow-x: hidden; /* never a horizontal scroller: horizontal drags are the pager's */
  overflow-y: auto;
  overscroll-behavior: none; /* no edge glow / scroll chaining from the page */
  /* touch-action does not inherit past a scroll container, so the pager's pan-y has to be restated here; without it
     the browser treats a horizontal drag on the page as its own scroll and fights the pager for the gesture. */
  touch-action: pan-y;
  /* No scrollbar: the box reaches 56px into the neighbouring page for shadows, so its bar would be drawn on that page
     (calibration 2026-10-12: a stray vertical line on Widgets). Touch-first; the wheel and keyboard still scroll. */
  scrollbar-width: none;
  margin: -24px -56px calc(-1 * var(--shadow-room));
  padding: 24px 56px calc(var(--nav-zone) + var(--shadow-room));
  scroll-padding-bottom: calc(var(--nav-zone) + var(--shadow-room)); /* a focused input is scrolled above the band */
}
.sheet::-webkit-scrollbar {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  .track,
  .backdrop,
  .underside,
  .pulled {
    transition-duration: 1ms;
  }
}
</style>
