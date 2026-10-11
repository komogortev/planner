<script setup lang="ts">
import LoopCard from '@/harness/LoopCard.vue'
import NotesDialog from '@/notes/NotesDialog.vue'

// S3 thin slice (2026-10-11): the Dashboard carries the daily loop — the built-in Daily task journal with its two
// copy-prompt steps — above the temporary notes dialog (D-14a), where the harness's questions and proposals are answered.
// Widget activation (D-18, D-53) is not built yet: the journal shows here unconditionally until it is.
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-4 py-4 flex flex-col gap-4" style="padding-bottom: 14dvh">
    <LoopCard />
    <NotesDialog />
  </div>
</template>
