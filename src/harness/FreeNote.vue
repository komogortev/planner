<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { captureEntry } from '@/capture/capture'
import { syncSoon } from '@/sync'

// G9 (owner, 2026-10-14; Q6 settled 2026-10-16): with no question waiting, the Journal still takes input — a question, a
// correction, anything. It lands as an ordinary note (no routing guess, nothing attached to the wrong Task), so the next
// run reads it like any other and it shows in Notes. Capture rules apply: one Dexie transaction with its outbox row.
const text = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)

async function save(): Promise<void> {
  if (busy.value || !text.value.trim()) return
  busy.value = true
  error.value = null
  const sent = text.value
  try {
    const r = await captureEntry(sent)
    if (!r.ok) error.value = r.error
    else {
      if (text.value === sent) text.value = '' // anything typed during the save stays (CodeReview R5-8)
      saved.value = true
      await nextTick()
      grow() // back to one line
      syncSoon()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void save()
  }
}
function grow(): void {
  const el = box.value
  if (el) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px` // scrollHeight leaves out the border
  }
}
function onInput(): void {
  saved.value = false
  grow()
}
defineExpose({ focus: () => box.value?.focus({ preventScroll: true }) })
</script>

<template>
  <div class="free" data-test="strip-free">
    <p class="sub">Nothing to answer. Tell the Journal something: a question, a correction, anything. It is kept as a note and read on the next run.</p>
    <div class="flex gap-1.5 mt-1.5 items-end">
      <textarea ref="box" v-model="text" rows="1" class="input in" aria-label="Tell the Journal" placeholder="Tell the Journal…" data-test="strip-free-text" @keydown="onKey" @input="onInput" />
      <button type="button" class="btn-ghost btn-xs" :disabled="busy || !text.trim()" data-test="strip-free-save" @click="save">Save</button>
    </div>
    <p v-if="saved" class="sub mt-1" role="status" data-test="strip-free-saved">Saved as a note. The next run reads it.</p>
    <p v-if="error" class="err" data-test="strip-free-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.free { margin-top: 0.5rem; }
.sub { font-size: 0.75rem; color: var(--glass-sub); }
.in { padding: 0.3rem 0.6rem; font-size: 0.85rem; resize: none; overflow: hidden; line-height: 1.35; }
.btn-xs { padding: 0.3rem 0.65rem; font-size: 0.78rem; border-radius: 0.6rem; }
.err { font-size: 0.75rem; color: var(--glass-err); margin-top: 0.25rem; }
</style>
