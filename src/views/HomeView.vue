<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { captureEntry } from '@/capture/capture'
import { isBlank } from '@/capture/draft'
import { createSubmitter } from '@/capture/submit'
import { createDictation, speechCtor } from '@/capture/dictation'
import { db } from '@/db'
import { useDraft } from '@/composables/useDraft'
import { useLiveQuery } from '@/composables/useLiveQuery'
import { useSyncState } from '@/composables/useSyncState'
import { syncSoon } from '@/sync'
import dictophone from '@/assets/dictophone.webp'

// Home = quickdraw (owner notes 10-11): ONE input expressing one intent — write it down. The prop is a dictophone:
// the cassette window IS the text area (tap = focus, nothing else on screen changes), the record key is Capture.
// With nothing written, the key just focuses the window. The unsynced count is the persisted outbox size, so it
// survives a reload (H1-ENTRIES.md section 5.1).
// The text survives a reload (D-56): a deploy reloads the app by itself, a phone kills a backgrounded one.
const { text, clear: clearText, flush: saveDraftNow } = useDraft()
const error = ref<string | null>(null)
const saved = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const unsynced = useLiveQuery(() => db.outbox.count(), 0)
const sync = useSyncState()
let savedTimer: number | undefined

// One capture at a time, and only what was captured leaves the box (capture/submit.ts): a second tap while the first is
// still writing is dropped, and text typed during the write stays.
const submit = createSubmitter({ get: () => text.value, set: (t) => { text.value = t } }, captureEntry)

// Voice (INPUT-TYPES.md V1): the mic key speaks into the window; the record key still saves. While listening the window
// is read-only (typed and spoken text would race) and the record key stops listening instead of saving, so a note is
// never saved half-heard.
const Speech = speechCtor()
const listening = ref(false)
const dictation = Speech
  ? createDictation({
      ctor: Speech,
      lang: navigator.language || 'en-US',
      get: () => text.value,
      set: (t) => {
        text.value = t
      },
      onListening: (l) => {
        listening.value = l
        if (!l) saveDraftNow()
      },
      onError: (m) => {
        error.value = m
      },
    })
  : null
function toggleVoice(): void {
  if (!dictation) return
  if (dictation.listening) return dictation.stop()
  error.value = null
  dictation.start()
}
onBeforeUnmount(() => dictation?.abort())

async function capture(): Promise<void> {
  if (dictation?.listening) return dictation.stop()
  const out = await submit()
  if (!out) return // a second tap while the first was still writing
  if (out.kind === 'empty') return box.value?.focus()
  if (out.kind === 'error') {
    error.value = out.error
    return
  }
  error.value = null
  // The box is empty (or holds only whitespace): the stored draft goes too — here, and in any other window that holds the
  // text that was captured. Otherwise what was typed during the write is the new draft, saved now rather than in 250 ms.
  if (isBlank(out.left)) clearText(out.sent)
  else saveDraftNow()
  syncSoon() // two seconds from now, not at once: a burst of captures is one request
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
  <div class="h-full flex flex-col items-center pt-3 pb-2">
    <!-- Device area: the largest dictophone (521x875 photo, 0.5954) that fits, centred. -->
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
          :readonly="listening"
          @keydown="onKey"
        />
        <!-- Red LED (top right): lights up when a capture lands. -->
        <span class="led" :class="{ 'led-on': saved, 'led-rec': listening }" aria-hidden="true" />
        <!-- Record key = Capture. -->
        <button class="key" data-test="capture-submit" aria-label="Capture" @click="capture" />
      </div>
    </div>

    <button
      v-if="dictation"
      type="button"
      class="mic"
      :class="{ 'mic-on': listening }"
      :aria-pressed="listening"
      :aria-label="listening ? 'Stop speaking' : 'Speak a note'"
      data-test="capture-voice"
      @click="toggleVoice"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      <span>{{ listening ? 'Listening… tap to stop' : 'Speak' }}</span>
    </button>
    <p v-if="error" class="text-sm text-err px-5 mt-2" data-test="capture-error">{{ error }}</p>
    <p class="text-xs text-slate-500 mt-2 h-4" data-test="capture-status">
      <template v-if="saved">Saved ✓</template>
      <template v-else-if="unsynced > 0">
        {{ unsynced }} not synced yet<template v-if="sync.phase === 'offline'"> · offline</template
        ><template v-else-if="sync.phase === 'syncing'"> · syncing…</template>
      </template>
      <template v-else-if="sync.initialPull && sync.phase === 'syncing'">Fetching your notes… {{ sync.pulled }}</template>
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
  /* Largest 521:875 box inside the area. */
  --w: min(94cqw, calc(100cqh * 0.5954));
  position: relative;
  width: var(--w);
  aspect-ratio: 521 / 875;
  background-size: 100% 100%;
  background-repeat: no-repeat;
  filter: drop-shadow(var(--float-1)) drop-shadow(var(--float-2));
}
/* Hotspots are placed in the photo's own proportions (measured on the cutout). */
.window {
  position: absolute;
  left: 23.8%;
  top: 36.8%;
  width: 51.6%;
  height: 16.9%;
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
  left: 63.9%;
  top: 79.4%;
  width: 25%;
  height: 12.3%;
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
  top: 26.1%;
  width: 4.6%;
  aspect-ratio: 1;
  border-radius: 50%;
  pointer-events: none;
  transition: box-shadow 160ms, background-color 160ms;
}
.mic {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  border: 1px solid rgb(120 113 108 / 0.5);
  background: rgb(248 245 232 / 0.7);
  color: #1c1917;
  font-size: 0.875rem;
  -webkit-tap-highlight-color: transparent;
}
.mic-on {
  border-color: rgb(239 68 68);
  color: rgb(185 28 28);
}
.led-rec {
  background: rgb(239 68 68 / 0.85);
  animation: rec 1.2s ease-in-out infinite;
}
@keyframes rec {
  50% {
    box-shadow: 0 0 10px 4px rgb(239 68 68 / 0.6);
  }
}
@media (prefers-reduced-motion: reduce) {
  .led-rec {
    animation: none;
  }
}
.led-on {
  background: rgb(239 68 68 / 0.85);
  box-shadow: 0 0 14px 6px rgb(239 68 68 / 0.75);
}
</style>
