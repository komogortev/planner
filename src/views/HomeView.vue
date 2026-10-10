<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { captureEntry } from '@/capture/capture'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'
import dictophone from '@/assets/dictophone.webp'

// Home = quickdraw (owner notes 10-11): ONE input expressing one intent — write it down. The prop is a dictophone:
// the cassette window is the input (tap it to write on the tape), the record key is Capture. With nothing written,
// the key opens the writing sheet instead. The unsynced count is the persisted outbox size, so it survives a reload
// (H1-ENTRIES.md section 5.1).
const text = ref('')
const error = ref<string | null>(null)
const saved = ref(false)
const writing = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const unsynced = useLiveQuery(() => db.outbox.count(), 0)
let savedTimer: number | undefined

async function openWriter(): Promise<void> {
  writing.value = true
  await nextTick()
  box.value?.focus()
}

async function capture(): Promise<void> {
  if (!text.value.trim()) return openWriter()
  const r = await captureEntry(text.value)
  if (!r.ok) {
    error.value = r.error
    return
  }
  error.value = null
  text.value = ''
  writing.value = false
  saved.value = true
  window.clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => (saved.value = false), 1800)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void capture()
  } else if (e.key === 'Escape') {
    writing.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col items-center pt-3" style="padding-bottom: 12dvh">
    <!-- Device area: the largest dictophone (520x876 photo, 0.5936) that fits, centred. -->
    <div class="device-area flex-1 min-h-0 w-full">
      <div class="device" :style="{ backgroundImage: `url(${dictophone})` }">
        <!-- Cassette window = the input. Shows the draft; tap to write. -->
        <button class="window" data-test="capture-window" aria-label="Write an entry" @click="openWriter">
          <span v-if="text" class="window-text" data-test="capture-draft">{{ text }}</span>
          <span v-else class="window-hint">tap to write</span>
        </button>
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

    <!-- Writing sheet: the whole screen for typing; the same key logic captures from here. -->
    <div v-if="writing" class="sheet" role="dialog" aria-modal="true" aria-label="Write an entry">
      <textarea
        ref="box"
        v-model="text"
        class="sheet-input"
        placeholder="What's on your mind?"
        aria-label="New entry"
        data-test="capture-input"
        @keydown="onKey"
      />
      <p v-if="error" class="text-sm text-rose-300" data-test="capture-error-sheet">{{ error }}</p>
      <div class="flex items-center justify-between gap-3">
        <button class="btn-ghost px-5 py-3" @click="writing = false">Done</button>
        <button class="btn-primary px-6 py-3" :disabled="!text.trim()" data-test="capture-sheet-submit" @click="capture">
          Capture
        </button>
      </div>
    </div>
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
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4% 5%;
  overflow: hidden;
  border-radius: 4px;
  background: rgb(248 245 232 / 0.86); /* the paper label laid on the tape */
  color: #1c1917;
  text-align: left;
  cursor: text;
}
.window-text {
  width: 100%;
  font: 600 clamp(11px, calc(var(--w) * 0.036), 16px) / 1.25 ui-monospace, Menlo, Consolas, monospace;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.window-hint {
  font: 500 clamp(10px, calc(var(--w) * 0.032), 14px) ui-monospace, Menlo, Consolas, monospace;
  color: #78716c;
  letter-spacing: 0.04em;
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
.sheet {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 20px 24px;
  background: rgb(2 6 23);
}
.sheet-input {
  flex: 1;
  min-height: 0;
  width: 100%;
  resize: none;
  border-radius: 1rem;
  background: rgb(15 23 42);
  border: 1px solid rgb(51 65 85);
  padding: 1rem;
  font-size: 1.125rem;
  line-height: 1.5;
  color: white;
}
.sheet-input:focus {
  outline: none;
  border-color: rgb(99 102 241);
}
</style>
