<script setup lang="ts">
import { ref } from 'vue'
import { useInstallPrompt } from '@/composables/useInstallPrompt'

const { visible, canInstall, showIOSHint, prompt, dismiss } = useInstallPrompt()

const showIOSPanel = ref(false)
const busy = ref(false)

async function onClick() {
  if (canInstall.value) {
    busy.value = true
    try {
      await prompt()
    } finally {
      busy.value = false
    }
  } else if (showIOSHint.value) {
    showIOSPanel.value = !showIOSPanel.value
  }
}
</script>

<template>
  <div v-if="visible" class="relative">
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
               text-indigo-300 hover:text-indigo-200 hover:bg-slate-800/80
               border border-slate-700 hover:border-indigo-500/60
               transition-colors disabled:opacity-50"
        :disabled="busy"
        :title="canInstall ? 'Install Personal Planner as an app' : 'How to install on iOS'"
        @click="onClick"
      >
        <!-- download/install glyph -->
        <svg
          aria-hidden="true"
          class="w-3.5 h-3.5"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10 3v9" />
          <path d="m6 9 4 4 4-4" />
          <path d="M4 17h12" />
        </svg>
        <span>Install app</span>
      </button>
      <button
        type="button"
        class="px-1.5 py-1 rounded-md text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors"
        title="Hide install button"
        aria-label="Hide install button"
        @click="dismiss"
      >
        ×
      </button>
    </div>

    <!-- iOS instructions popover -->
    <div
      v-if="showIOSHint && showIOSPanel"
      class="absolute right-0 mt-2 w-72 z-30 p-3 rounded-lg shadow-xl
             bg-slate-900 border border-slate-700 text-xs text-slate-200"
      role="dialog"
    >
      <p class="font-semibold mb-1.5 text-slate-100">Install on iOS</p>
      <ol class="space-y-1 list-decimal list-inside text-slate-300">
        <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
        <li>Scroll and choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong> in the top-right.</li>
      </ol>
      <button
        type="button"
        class="mt-2 text-[11px] text-slate-400 hover:text-slate-200"
        @click="showIOSPanel = false"
      >
        Close
      </button>
    </div>
  </div>
</template>
