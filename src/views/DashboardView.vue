<script setup lang="ts">
import DailyCard from '@/harness/DailyCard.vue'
import JournalCard from '@/harness/JournalCard.vue'
import QuestionsStrip from '@/harness/QuestionsStrip.vue'
import { useLoop2 } from '@/harness/useLoop2'
import NotesDialog from '@/notes/NotesDialog.vue'

// Dashboard v2 (HW-HARNESS §11, S3 v2 slice S3): the questions strip on top (one at a time, under the Task it isolates, and
// the harness run), Daily in the middle (today's Tasks, editable summary), the optional written summary, then the notes —
// input history only. One live subscription feeds the strip and Daily. Widget activation (D-18, D-53) is not built yet.
const loop = useLoop2()
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-4 py-4 flex flex-col gap-4" style="padding-bottom: 14dvh">
    <QuestionsStrip :loop="loop" />
    <DailyCard :loop="loop" />
    <JournalCard />
    <NotesDialog />
  </div>
</template>
