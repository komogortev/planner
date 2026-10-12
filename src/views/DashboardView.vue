<script setup lang="ts">
import DailyCard from '@/harness/DailyCard.vue'
import JournalCard from '@/harness/JournalCard.vue'
import QuestionsStrip from '@/harness/QuestionsStrip.vue'
import { useLoop2 } from '@/harness/useLoop2'
import NotesDialog from '@/notes/NotesDialog.vue'

// Dashboard v2 (HW-HARNESS §11, S3 v2 slice S3): Daily on top (today's Tasks, editable summary, Coming up), the optional
// written summary and the notes (input history) in their own scroll box; the questions strip fixed under it
// (calibration 2026-10-12): the cards stop at the strip and never scroll it. One live subscription feeds the strip and
// Daily. Widget activation (D-18, D-53) is not built yet.
const loop = useLoop2()
</script>

<template>
  <div class="dash max-w-2xl mx-auto w-full px-4">
    <div class="cards" data-test="dashboard-cards">
      <DailyCard :loop="loop" />
      <JournalCard />
      <NotesDialog />
    </div>
    <QuestionsStrip class="dock" :loop="loop" />
  </div>
</template>

<style scoped>
/* The page fills its sheet's content box (which ends at the bottom band); the cards scroll in their own box and the
   strip sits below it. The sheet itself never scrolls here. */
.dash { height: 100%; display: flex; flex-direction: column; }
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
  /* Shadow room on every side (negative margin = padding): the last card stops at the strip or the band, and its
     shadow carries on under the strip or into the band instead of being cut at the box's edge. */
  margin: 0 -56px calc(-1 * var(--shadow-room));
  padding: 1rem 56px var(--shadow-room);
  scroll-padding-bottom: var(--shadow-room); /* a focused input is scrolled above the strip, not under it */
}
.dock { flex: none; }
</style>
