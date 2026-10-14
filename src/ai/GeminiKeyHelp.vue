<script setup lang="ts">
import { ref } from 'vue'
import { GEMINI_KEY_URL } from './models'

// How to get a free Gemini key (owner, 2026-10-14: testers bring their own key, D-114). The steps follow Google's own
// pages as read on 2026-10-14 (ai.google.dev/gemini-api/docs/api-key, /terms, /rate-limits); re-read them when a step
// stops matching. A disclosure, not a popover: the panel opens in the form's flow and pushes the key field down, so the
// field it tells you to fill stays visible (an absolute panel covered it, CodeReview). Esc inside it closes it.
const open = ref(false)
const btn = ref<HTMLButtonElement | null>(null)

function close() {
  if (!open.value) return
  open.value = false
  btn.value?.focus()
}
</script>

<template>
  <div class="min-w-0" @keydown.esc="close">
    <button
      ref="btn" type="button" class="help-btn" :aria-expanded="open" aria-controls="gemini-key-help" data-test="gemini-help-open"
      @click="open = !open"
    >
      How do I get a free Gemini key?
    </button>
    <div v-show="open" id="gemini-key-help" class="panel" role="region" aria-label="Get a free Gemini key" data-test="gemini-help">
      <ol class="steps">
        <li>
          Open <a :href="GEMINI_KEY_URL" target="_blank" rel="noopener noreferrer" data-test="gemini-help-link">Google AI Studio → API keys</a>
          and sign in with a Google account. You must be 18 or older.
        </li>
        <li>Accept the terms. A first-time account gets a project and a key on its own; otherwise tap <strong>Create API key</strong>.</li>
        <li>Recommended: on the key, choose <strong>Add restrictions</strong> → <strong>Restrict to Gemini API only</strong>.</li>
        <li>Copy the key and paste it into <strong>API key</strong> below. Keep the model id, tap <strong>Save</strong>, then <strong>Test</strong>.</li>
      </ol>
      <p class="mt-2 warn">
        Outside the EEA, Switzerland and the UK, Google may use what you send on the free tier to improve its products, and
        people at Google may read it. Each run with this model sends your notes to Google. If that is not OK, turn on billing
        for the key's project in AI Studio.
      </p>
      <p class="mt-1.5 sub">Free use has request limits, including a daily one (AI Studio shows yours). You can delete the key there at any time.</p>
      <button type="button" class="close" data-test="gemini-help-close" @click="close">Close</button>
    </div>
  </div>
</template>

<style scoped>
.help-btn { font-size: 0.78rem; text-decoration: underline; text-underline-offset: 2px; color: var(--glass-text); padding: 4px 0; }
.panel {
  margin: 2px 0 6px;
  padding: 12px;
  border-radius: 10px;
  font-size: 0.78rem;
  line-height: 1.45;
  background: rgb(var(--s-900));
  color: rgb(var(--s-100));
  border: 1px solid rgb(var(--s-700));
}
.steps { list-style: decimal; padding-left: 1.1rem; display: grid; gap: 4px; }
.steps a { text-decoration: underline; text-underline-offset: 2px; }
.warn { color: var(--glass-warn); }
.sub { color: rgb(var(--s-400)); }
.close { margin-top: 8px; font-size: 0.72rem; color: rgb(var(--s-400)); }
.close:hover { color: rgb(var(--s-100)); }
</style>
