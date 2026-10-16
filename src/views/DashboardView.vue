<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import DailyCard from '@/harness/DailyCard.vue'
import SummaryCard from '@/harness/SummaryCard.vue'
import QuestionsStrip from '@/harness/QuestionsStrip.vue'
import { useLoop2 } from '@/harness/useLoop2'
import NotesDialog from '@/notes/NotesDialog.vue'
import { useWidgets } from '@/widgets/useWidgets'
import ProjectCard from '@/widgets/ProjectCard.vue'
import { pendingSummary } from '@/harness/summaryRun'

// Dashboard v2 (HW-HARNESS §11, S3 v2 slice S3): Daily on top (today's Tasks, editable summary, Coming up), the optional
// written summary and the notes (input history) in their own scroll box, and the questions strip docked at the bottom
// (calibration 2026-10-12). One live subscription feeds the strip and Today. Each card is a system widget shown only while
// active (D-107…D-110, Widgets page; per account): Today on by default, Summary and Notes off. The strip is not a widget.
//
// The strip sits over the bottom of the cards' box, which is measured: while it shows, the box ends at the strip's bottom
// edge and pads by its height, so the last card stops at the strip's top and anything scrolling past is hidden by the
// strip — no shadow cut below it. With no strip the box runs into the band by --shadow-room, so shadows fall uncut.
const loop = useLoop2()
const { widgets, loaded, isActive, projects } = useWidgets()
const dock = ref<HTMLElement | null>(null)
const stripH = ref(0)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!dock.value || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => (stripH.value = dock.value?.offsetHeight ?? 0))
  ro.observe(dock.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div class="dash max-w-2xl mx-auto w-full px-4">
    <div class="cards" :class="{ 'cards-docked': stripH > 0 }" :style="{ '--strip-h': `${stripH}px` }" data-test="dashboard-cards">
      <DailyCard v-if="isActive('system-today')" :loop="loop" />
      <!-- A Summary run still waiting keeps its card (switched off on another device): unmounting would abort the call. -->
      <SummaryCard v-if="isActive('system-summary') || pendingSummary() !== null" />
      <NotesDialog v-if="isActive('system-notes')" :now="loop.now.value" />
      <ProjectCard v-for="p in projects.filter((x) => x.active)" :key="p.id" :project="p" />
      <p v-if="loaded && !widgets.some((w) => w.active) && !projects.some((p) => p.active)" class="none" data-test="dashboard-none">No widgets on. Switch one on in Widgets.</p>
    </div>
    <div ref="dock" class="dock" data-test="strip-dock">
      <QuestionsStrip :loop="loop" />
    </div>
  </div>
</template>

<style scoped>
/* The page fills its sheet's content box (which ends at the bottom band). The sheet itself never scrolls here. */
.dash { height: 100%; position: relative; display: flex; flex-direction: column; }
.cards {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: none;
  touch-action: pan-y; /* restated past a scroll container (see Pager.vue .sheet) */
  display: flex;
  flex-direction: column;
  gap: 1rem;
  /* Shadow room at the sides and top, as the sheet gives (negative margin = padding); below, see the comment above. */
  margin: 0 -56px calc(-1 * var(--shadow-room));
  padding: 1rem 56px var(--shadow-room);
  scroll-padding-bottom: var(--shadow-room); /* a focused input is scrolled above the band */
  scrollbar-width: none; /* reaches 56px into the next page for shadows: its bar would be drawn there (see Pager .sheet) */
}
.cards::-webkit-scrollbar { display: none; }
.cards-docked {
  margin-bottom: 0;
  padding-bottom: var(--strip-h);
  scroll-padding-bottom: var(--strip-h); /* a focused input is scrolled above the strip, not under it */
}
/* glass text, not slate: it sits on the page's photo like the cards */
.none { color: var(--glass-text); font-size: 0.9rem; text-align: center; margin-top: 2rem; }
.dock { position: absolute; left: 1rem; right: 1rem; bottom: 0; z-index: 1; max-height: 68%; display: flex; flex-direction: column; } /* against the page, not the screen: banners and landscape shrink it */
</style>
