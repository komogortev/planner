<script setup lang="ts">
import { ref } from 'vue'
import { captureEntry } from '@/capture/capture'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import dictophone from '@/assets/dictophone.webp'

// Home = quickdraw (owner notes 10-11): ONE input expressing one intent — write it down. The prop is a dictophone:
// the cassette window IS the text area (tap = focus, nothing else on screen changes), the record key is Capture.
// With nothing written, the key just focuses the window. The unsynced count is the persisted outbox size, so it
// survives a reload (H1-ENTRIES.md section 5.1).
const text = ref('')
const error = ref<string | null>(null)
const saved = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const unsynced = useLiveQuery(() => db.outbox.count(), 0)
let savedTimer: number | undefined

async function capture(): Promise<void> {
  if (!text.value.trim()) return box.value?.focus()
  const r = await captureEntry(text.value)
  if (!r.ok) {
    error.value = r.error
    return
  }
  error.value = null
  text.value = ''
  saved.value = true
  window.clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => (saved.value = false), 1800)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void capture()
  }
}
</script>

<template>
  <div class="h-full flex flex-col items-center pt-3" style="padding-bottom: 12dvh">
    <!-- Device area: the largest dictophone (520x876 photo, 0.5936) that fits, centred. -->
    <div class="device-area flex-1 min-h-0 w-full">
      <div class="device" :style="{ backgroundImage: `url(${dictophone})` }">
        <!-- Cassette window = the input: a paper label laid on the tape, a real text area. -->
        <textarea
          ref="box"
          v-model="text"
          class="window"
          placeholder="What's on your mind?"
          aria-label="New entry"
          data-test="capture-input"
          @keydown="onKey"
        />
        <!-- Red LED (top right): lights up when a capture lands. -->
        <span class="led" :class="{ 'led-on': saved }" aria-hidden="true" />
        <!-- Record key = Capture. -->
        <button class="key" data-test="capture-submit" aria-label="Capture" @click="capture" />
      </div>
    </div>

    <p v-if="error" class="text-sm text-rose-300 px-5 mt-2" data-test="capture-error">{{ error }}</p>
    <p class="text-xs text-slate-500 mt-2 h-4" data-test="capture-status">
      <template v-if="saved">Saved ✓</template>
      <template v-else-if="unsynced > 0">{{ unsynced }} not synced yet</template>
    </p>
  </div>
</template>

<style scoped>
.device-area {
  container-type: size;
  display: flex;
  align-items: center;
  justify-content: center;
}
.device {
  /* Largest 520:876 box inside the area. */
  --w: min(94cqw, calc(100cqh * 0.5936));
  position: relative;
  width: var(--w);
  aspect-ratio: 520 / 876;
  background-size: 100% 100%;
  background-repeat: no-repeat;
  filter: drop-shadow(0 10px 24px rgb(0 0 0 / 0.55));
}
/* Hotspots are placed in the photo's own proportions (measured on the cutout). */
.window {
  position: absolute;
  left: 23.2%;
  top: 36.5%;
  width: 52.1%;
  height: 15.3%;
  padding: 4% 5%;
  border: 0;
  border-radius: 4px;
  resize: none;
  background: rgb(248 245 232 / 0.86); /* the paper label laid on the tape */
  color: #1c1917;
  font: 600 clamp(12px, calc(var(--w) * 0.036), 16px) / 1.25 ui-monospace, Menlo, Consolas, monospace;
  overflow-y: auto;
}
.window::placeholder {
  color: #78716c;
  font-weight: 500;
}
.window:focus {
  outline: 2px solid rgb(99 102 241);
  outline-offset: 1px;
}
.key {
  position: absolute;
  left: 64.2%;
  top: 79.5%;
  width: 25.4%;
  height: 12.2%;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.key:active {
  background: rgb(0 0 0 / 0.22);
}
.led {
  position: absolute;
  left: 81.2%;
  top: 25.9%;
  width: 5.3%;
  aspect-ratio: 1;
  border-radius: 50%;
  pointer-events: none;
  transition: box-shadow 160ms, background-color 160ms;
}
.led-on {
  background: rgb(239 68 68 / 0.85);
  box-shadow: 0 0 14px 6px rgb(239 68 68 / 0.75);
}
</style>
