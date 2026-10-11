<script setup lang="ts">
import { useRouter } from 'vue-router'

// The empty Dashboard offers AddWidget, which swipes to the Widgets page (D-18). Always empty until the widgets
// design session defines what an activated widget is (D-53).
const router = useRouter()
</script>

<template>
  <div class="max-w-2xl mx-auto w-full px-6 py-8">
    <h2 class="text-xl font-bold">Dashboard</h2>
    <p class="text-sm text-slate-500 mt-1">Activated widgets will list here.</p>
    <div class="card mt-6 text-center">
      <p class="text-sm text-slate-400">Nothing activated yet.</p>
      <button type="button" class="btn-ghost mt-4" data-test="add-widget" @click="router.push('/widgets')">
        Add widget
      </button>
    </div>
  </div>
</template>
