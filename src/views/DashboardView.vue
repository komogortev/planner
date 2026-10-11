<script setup lang="ts">
import { useRouter } from 'vue-router'
import NotesDialog from '@/notes/NotesDialog.vue'

// The empty Dashboard offers AddWidget, which swipes to the Widgets page (D-18). Always empty until the widgets
// design session defines what an activated widget is (D-53). Below it, the temporary notes dialog (D-14a) shows what
// has been captured; the notes widget replaces it.
const router = useRouter()
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-4 py-4 flex flex-col gap-4" style="padding-bottom: 14dvh">
    <div class="card text-center">
      <p class="text-sm text-slate-400">No widgets activated yet.</p>
      <button type="button" class="btn-ghost mt-3" data-test="add-widget" @click="router.push('/widgets')">
        Add widget
      </button>
    </div>
    <NotesDialog />
  </div>
</template>
