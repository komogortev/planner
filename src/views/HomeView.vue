<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { captureEntry } from '@/capture/capture'
import { db } from '@/db'
import { useLiveQuery } from '@/composables/useLiveQuery'

// Home = quickdraw (owner notes 10-11): ONE input expressing one intent — write it down. The unsynced count is the
// persisted outbox size, so it survives a reload (H1-ENTRIES.md section 5.1).
const text = ref('')
const error = ref<string | null>(null)
const saved = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const unsynced = useLiveQuery(() => db.outbox.count(), 0)
let savedTimer: number | undefined

async function submit(): Promise<void> {
  if (!text.value.trim()) return
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
  await nextTick()
  box.value?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void submit()
  }
}
</script>

<template>
  <div class="h-full flex flex-col px-5 pt-6 pb-4 gap-3">
    <textarea
      ref="box"
      v-model="text"
      class="quick-input flex-1 min-h-0"
      placeholder="What's on your mind?"
      aria-label="New entry"
      data-test="capture-input"
      @keydown="onKey"
    />
    <p v-if="error" class="text-sm text-rose-300" data-test="capture-error">{{ error }}</p>
    <div class="flex items-center justify-between gap-3">
      <span class="text-xs text-slate-500" data-test="capture-status">
        <template v-if="saved">Saved ✓</template>
        <template v-else-if="unsynced > 0">{{ unsynced }} not synced yet</template>
      </span>
      <button class="btn-primary px-6 py-3" :disabled="!text.trim()" data-test="capture-submit" @click="submit">
        Capture
      </button>
    </div>
  </div>
</template>

<style scoped>
.quick-input {
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
.quick-input:focus {
  outline: none;
  border-color: rgb(99 102 241);
}
</style>
