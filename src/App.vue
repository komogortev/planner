<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router'
import EnvBanner from '@/components/EnvBanner.vue'
import VersionBadge from '@/components/VersionBadge.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import BottomNav from '@/shell/BottomNav.vue'
import { isSwipe, swipeTarget } from '@/shell/pages'

const route = useRoute()
const router = useRouter()

// Horizontal swipe moves to the adjacent page (stops at the ends). Vertical scroll is left alone.
let start: { x: number; y: number } | null = null
function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  start = t ? { x: t.clientX, y: t.clientY } : null
}
function onTouchEnd(e: TouchEvent): void {
  const t = e.changedTouches[0]
  if (!start || !t) return
  const dx = t.clientX - start.x
  const dy = t.clientY - start.y
  start = null
  if (!isSwipe(dx, dy)) return
  const target = swipeTarget(route.path, dx)
  if (target) void router.push(target)
}
</script>

<template>
  <!-- One full screen (h-dvh), never scrolls itself; only <main> does. Nothing may be wider than the screen: an
       overflowing child makes mobile browsers zoom the page out. No header: the bottom bar is hidden until touched. -->
  <div class="h-dvh flex flex-col overflow-hidden">
    <EnvBanner />
    <UpdateBanner />
    <main
      class="flex-1 min-h-0 overflow-y-auto pb-8"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <RouterView />
    </main>
    <BottomNav />
    <VersionBadge />
  </div>
</template>
