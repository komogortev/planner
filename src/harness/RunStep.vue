<script setup lang="ts">
import { ref } from 'vue'
import { copyPrompt } from './clipboard'

// One copy-prompt round trip (D-35, D-63): compose → copy → paste the reply → check → store. The stage-specific work is
// passed in; this component only owns the steps. A run composed earlier (before the phone killed the app) is still
// waiting: `waiting` says so and the paste box opens without a new prompt.
export type Check = { ok: true; lines: string[] } | { ok: false; error: string }
const props = defineProps<{
  title: string
  waiting: boolean
  compose: () => Promise<{ prompt: string; notes: number; note?: string } | null>
  check: (reply: string) => Promise<Check>
  store: (reply: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }>
}>()
const emit = defineEmits<{ stored: [] }>()

const prompt = ref<string | null>(null)
const info = ref<string | null>(null)
const reply = ref('')
const preview = ref<string[] | null>(null)
const error = ref<string | null>(null)
const done = ref<string | null>(null)
const busy = ref(false)
const open = ref(props.waiting)

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (busy.value) return undefined
  busy.value = true
  try {
    return await fn()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return undefined
  } finally {
    busy.value = false
  }
}

async function start(): Promise<void> {
  error.value = done.value = null
  preview.value = null
  reply.value = '' // a reply to the previous prompt must not be checked against the new run
  await run(async () => {
    const out = await props.compose()
    if (!out) {
      prompt.value = null
      open.value = false
      info.value = 'Nothing to send: no note needs this step right now.'
      return
    }
    prompt.value = out.prompt
    open.value = true
    info.value = `${out.notes} note${out.notes === 1 ? '' : 's'} will leave this device in the prompt.${out.note ? ` ${out.note}` : ''}`
    const copied = await copyPrompt(out.prompt)
    if (!copied) error.value = 'Copy was refused by the browser. Select the prompt below and copy it by hand.'
    else info.value += ' Copied — paste it into your AI app, then paste its whole reply here. The prompt holds your notes: the app clears the clipboard after 2 minutes only where the browser already lets it read the clipboard, so clear it yourself after pasting.'
  })
}

// Straight from the tap, with no await before the write: some phone browsers refuse a clipboard write that comes after
// one (the first copy above follows the compose), so this is the path that always has the gesture.
async function copyAgain(): Promise<void> {
  if (!prompt.value) return
  error.value = (await copyPrompt(prompt.value)) ? null : 'Copy was refused by the browser. Open "Show the prompt" and copy it by hand.'
  if (!error.value) info.value = 'Copied. Paste it into your AI app, then paste its whole reply here.'
}

async function checkReply(): Promise<void> {
  error.value = done.value = null
  await run(async () => {
    const r = await props.check(reply.value)
    if (r.ok) preview.value = r.lines
    else {
      preview.value = null
      error.value = r.error
    }
  })
}

async function storeReply(): Promise<void> {
  error.value = null
  await run(async () => {
    const r = await props.store(reply.value)
    if (!r.ok) {
      error.value = r.error
      return
    }
    done.value = r.message
    reply.value = ''
    preview.value = null
    prompt.value = null
    open.value = false
    info.value = null
    emit('stored')
  })
}
</script>

<template>
  <section class="step" :data-test="`run-step`">
    <header class="flex items-center justify-between gap-2">
      <h4 class="font-semibold text-sm">{{ title }}</h4>
      <button type="button" class="btn-ghost btn-sm" :disabled="busy" data-test="run-compose" @click="start">
        {{ prompt || waiting ? 'New prompt' : 'Copy prompt' }}
      </button>
    </header>
    <p v-if="waiting && !prompt" class="sub" data-test="run-waiting">A prompt you copied earlier is waiting for its reply.</p>
    <p v-if="info" class="sub" data-test="run-info">{{ info }}</p>
    <button v-if="prompt" type="button" class="btn-ghost btn-sm mt-2" data-test="run-copy-again" @click="copyAgain">Copy again</button>
    <details v-if="prompt" class="mt-2">
      <summary class="sub cursor-pointer">Show the prompt</summary>
      <textarea class="input mt-1 text-xs" rows="6" readonly :value="prompt" />
    </details>
    <template v-if="open || waiting">
      <textarea v-model="reply" class="input mt-2 text-xs" rows="4" placeholder="Paste the AI reply here" aria-label="AI reply" data-test="run-reply" @input="preview = null" />
      <div class="flex gap-2 mt-2">
        <button type="button" class="btn-ghost btn-sm" :disabled="busy || !reply.trim()" data-test="run-check" @click="checkReply">Check</button>
        <button v-if="preview" type="button" class="btn-primary btn-sm" :disabled="busy" data-test="run-store" @click="storeReply">Store</button>
      </div>
    </template>
    <ul v-if="preview" class="preview" data-test="run-preview">
      <li v-for="(l, i) in preview" :key="i">{{ l }}</li>
    </ul>
    <p v-if="error" class="err" data-test="run-error">{{ error }}</p>
    <p v-if="done" class="sub" data-test="run-done">{{ done }}</p>
  </section>
</template>

<style scoped>
.step { padding: 0.6rem 0; border-top: 1px solid var(--glass-edge); }
.sub { font-size: 0.78rem; color: var(--glass-sub); margin-top: 0.35rem; }
.err { font-size: 0.8rem; color: #fda4af; margin-top: 0.35rem; }
.preview { font-size: 0.8rem; margin-top: 0.5rem; padding-left: 1rem; list-style: disc; color: var(--glass-text); }
.btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; }
</style>
