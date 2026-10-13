<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { storedToken } from '@/auth/signIn'
import { awaitCall, deleteModel, listModels, ModelsError, outcomeText, presetOf, PRESETS, saveModel, testModel, type ModelView, type Preset } from './models'
import { reconcileRunModel, runModel, setRunModel, unsetRunModel } from './runWith'

// Settings → AI models (H5-MODELS §6, S2). Register a model with its API key, test it, remove it, and choose which one this
// device runs with ("Copy and paste" is always there). The key goes to the Worker once, on save, and never comes back: the
// list shows its last 4 characters only. A test is a real call through the same path as a run (D-92): the provider's model
// list is not proof that a model works.
const online = useOnline()
const signedIn = storedToken() !== null // signing in or out leaves Settings, so read once
const models = ref<ModelView[]>([])
const loaded = ref(false)
const listError = ref<string | null>(null)
const tests = reactive<Record<string, string>>({}) // model id → outcome line
const removing = ref<string | null>(null) // armed "Remove?" tap
let abort: AbortController | null = null

async function refresh(): Promise<void> {
  listError.value = null
  try {
    models.value = await listModels()
    // The device's choice must still exist with a key; a device that never chose follows the account's only model (D-102).
    reconcileRunModel(models.value)
  } catch (err) {
    listError.value = err instanceof ModelsError ? err.message : String(err)
  } finally {
    loaded.value = true
  }
}
onMounted(() => { if (signedIn && online.value) void refresh() })
// Opened offline, then the connection came back: load then, not on the next visit (CodeReview L7).
watch(online, (now) => { if (now && signedIn && !loaded.value) void refresh() })
onBeforeUnmount(() => abort?.abort())

const usable = computed(() => models.value.filter((m) => m.hasKey))
const host = (m: ModelView) => new URL(m.baseUrl).hostname

// ── Add ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_MAX_TOKENS = 16000
const form = reactive({ preset: 'gemini' as Preset['id'], label: '', model: '', baseUrl: '', key: '', maxTokens: DEFAULT_MAX_TOKENS })
const preset = computed(() => PRESETS.find((p) => p.id === form.preset)!)
const saving = ref(false)
/** The base URL as the Worker stores it (`api/src/modelRules.ts`: origin + path, no trailing slash), for the duplicate check. */
function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return raw
  }
}
const addBox = ref<HTMLDetailsElement | null>(null)
const formError = ref<string | null>(null)
function pickPreset(): void {
  form.label = preset.value.name
  form.model = preset.value.model
  form.baseUrl = preset.value.baseUrl
}
pickPreset()
async function add(): Promise<void> {
  formError.value = null
  saving.value = true
  try {
    const p = preset.value
    const baseUrl = p.id === 'custom' ? form.baseUrl.trim() : p.baseUrl
    const same = models.value.find((m) => m.format === p.format && m.baseUrl === cleanUrl(baseUrl) && m.model === form.model.trim())
    if (same) {
      formError.value = `Already added as "${same.label}". To change its key, remove it and add it again.`
      return
    }
    const saved = await saveModel(crypto.randomUUID(), {
      label: form.label.trim(), format: p.format, baseUrl, model: form.model.trim(), maxTokens: form.maxTokens, key: form.key.trim(),
    })
    form.key = '' // never kept in the page longer than the save
    await refresh()
    tests[saved.id] = 'Saved. Test it to make sure it answers.'
    // Close and reset the form, so the result shows in the list: an open, filled form read as "nothing happened" and a
    // second Save added a duplicate (2026-10-12).
    if (addBox.value) addBox.value.open = false
    pickPreset()
    form.maxTokens = DEFAULT_MAX_TOKENS
  } catch (err) {
    formError.value = err instanceof ModelsError ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

// ── Test · remove · choose ─────────────────────────────────────────────────────────────────────────────────────────
async function test(m: ModelView): Promise<void> {
  tests[m.id] = 'Testing…'
  abort ??= new AbortController()
  try {
    const t0 = Date.now()
    const view = await awaitCall((await testModel(m.id)).id, { signal: abort.signal, intervalMs: 1_500 })
    tests[m.id] = view.status === 'ok' ? `Works — answered in ${Math.round((Date.now() - t0) / 1000)} s.` : outcomeText(view.status)
  } catch (err) {
    if (abort?.signal.aborted) return
    tests[m.id] = err instanceof ModelsError ? err.message : String(err)
  }
}
async function remove(m: ModelView): Promise<void> {
  if (removing.value !== m.id) { removing.value = m.id; return }
  removing.value = null
  try {
    await deleteModel(m.id)
    if (runModel.value?.id === m.id) unsetRunModel() // not left chosen if the list below fails (CodeReview A1)
    delete tests[m.id]
    await refresh()
  } catch (err) {
    tests[m.id] = err instanceof ModelsError ? err.message : String(err)
  }
}
const choose = (m: ModelView | null) => setRunModel(m ? { id: m.id, label: m.label } : null)
</script>

<template>
  <section class="card" data-test="models-card">
    <h3 class="font-semibold mb-1">AI models</h3>
    <p class="text-xs text-slate-500 mb-3">
      Runs can use your own model instead of copy and paste. You pay your provider; your notes go to it on each run. The key
      is stored encrypted and never shown again.
    </p>

    <p v-if="!signedIn || !online" class="text-sm text-slate-400" data-test="models-offline">Sign in and go online to manage models.</p>
    <template v-else>
      <p v-if="listError" class="text-sm text-rose-300" role="alert" data-test="models-error">{{ listError }}</p>

      <h4 class="font-semibold text-sm mb-2">This device runs with</h4>
      <div class="choice" role="radiogroup" aria-label="This device runs with" data-test="run-with">
        <button role="radio" class="opt" :class="{ 'opt-on': !runModel }" :aria-checked="!runModel" data-test="run-with-manual" @click="choose(null)">Copy and paste</button>
        <button
          v-for="m in usable" :key="m.id" role="radio" class="opt" :class="{ 'opt-on': runModel?.id === m.id }" :aria-checked="runModel?.id === m.id"
          :data-test="`run-with-${m.id}`" @click="choose(m)"
        >{{ m.label }}</button>
      </div>
      <p class="text-xs text-amber-300 mt-2" data-test="run-with-warning">
        A device that has not chosen runs with your only model. Add or choose a model only after every device you use has
        opened this version of the app once: an older version drops runs made by a model when it syncs.
      </p>

      <ul class="list" data-test="models-list">
        <li v-for="m in models" :key="m.id" class="row" :data-test="`model-${m.id}`">
          <div class="min-w-0">
            <p class="text-sm font-semibold truncate">{{ m.label }}</p>
            <p class="text-xs text-slate-400 truncate">{{ m.model }} · {{ host(m) }} · {{ m.hasKey ? `key …${m.keyHint}` : 'no key' }}</p>
            <p v-if="tests[m.id]" class="text-xs mt-1" :class="tests[m.id]!.startsWith('Works') ? 'text-emerald-300' : 'text-slate-300'" role="status" data-test="model-test-result">{{ tests[m.id] }}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button class="btn-ghost btn-sm" :disabled="!m.hasKey || tests[m.id] === 'Testing…'" data-test="model-test" @click="test(m)">Test</button>
            <button class="btn-ghost btn-sm" data-test="model-remove" @click="remove(m)">{{ removing === m.id ? 'Remove?' : 'Remove' }}</button>
          </div>
        </li>
        <li v-if="loaded && models.length === 0" class="text-sm text-slate-400" data-test="models-empty">No models yet.</li>
      </ul>

      <details ref="addBox" class="mt-4 min-w-0" data-test="model-add">
        <summary class="text-sm font-semibold cursor-pointer">Add a model</summary>
        <form class="grid gap-2 mt-3 min-w-0" autocomplete="off" @submit.prevent="add">
          <label class="label" for="m-preset">Provider</label>
          <select id="m-preset" v-model="form.preset" class="input" data-test="model-preset" @change="pickPreset">
            <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <p v-if="preset.note" class="text-xs text-amber-300" data-test="model-preset-note">{{ preset.note }}</p>
          <label class="label" for="m-label">Name</label>
          <input id="m-label" v-model="form.label" class="input" maxlength="60" required data-test="model-label" />
          <label class="label" for="m-model">Model id</label>
          <input id="m-model" v-model="form.model" class="input" required spellcheck="false" autocapitalize="off" placeholder="as the provider names it" data-test="model-id" />
          <template v-if="preset.id === 'custom'">
            <label class="label" for="m-base">Endpoint (https)</label>
            <input id="m-base" v-model="form.baseUrl" class="input" required spellcheck="false" autocapitalize="off" placeholder="https://…/v1" data-test="model-base" />
          </template>
          <p v-else class="text-xs text-slate-500 break-all">Endpoint: {{ preset.baseUrl }}</p>
          <label class="label" for="m-max">Max tokens per reply</label>
          <input id="m-max" v-model.number="form.maxTokens" class="input" type="number" min="256" max="64000" step="1" required data-test="model-max" />
          <label class="label" for="m-key">API key</label>
          <input id="m-key" v-model="form.key" class="input" type="password" required autocomplete="off" spellcheck="false" autocapitalize="off" data-test="model-key" />
          <p v-if="formError" class="text-sm text-rose-300" role="alert" data-test="model-form-error">{{ formError }}</p>
          <button class="btn-primary justify-self-start" type="submit" :disabled="saving" data-test="model-save">{{ saving ? 'Saving…' : 'Save' }}</button>
        </form>
      </details>
    </template>
  </section>
</template>

<style scoped>
.choice { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 12px; background: rgb(var(--s-800)); }
.opt { flex: 1 1 auto; padding: 8px 10px; border-radius: 9px; font-size: 0.875rem; font-weight: 600; color: rgb(var(--s-400)); }
.opt-on { background: rgb(var(--s-950)); color: rgb(var(--s-100)); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
.list { margin-top: 1rem; display: grid; gap: 0.75rem; }
.row { min-width: 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
form :is(input, select) { min-width: 0; width: 100%; }
.btn-sm { padding: 0.3rem 0.75rem; font-size: 0.78rem; }
</style>
