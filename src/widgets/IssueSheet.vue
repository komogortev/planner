<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { IntegrationsError, ISSUE_BODY_MAX, ISSUE_TITLE_MAX, sendIssue, type IssueKind, type SentIssue } from '@/integrations/github'
import { githubLink } from './projectView'

// New issue on a project card (C2, docs/GITHUB-BRIDGE.md §7). Only the Send tap sends; nothing is queued (online only,
// Q3). A public repo is named before Send (Q4). One request id per draft: a retry after a lost answer reuses it, and the
// Worker answers with the issue that already landed instead of making a second. The id is renewed only after a success.
// Modal like the menu sheet: scrim, Escape, Tab wraps, focus goes back to the button that opened it.
// C3: "Ask Claude to work on it" shows only when the repo runs the Claude Code Action (`claude: true`); otherwise the sheet
// offers set-up help. The planner never writes workflows or secrets.
const props = defineProps<{ repo: string; isPrivate: boolean; kinds: IssueKind[]; claude: boolean | null; trigger: HTMLElement | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ sent: [issue: SentIssue] }>()
const online = useOnline()

const title = ref('')
const body = ref('')
const kind = ref<string | null>(null)
const askClaude = ref(false)
const helpOpen = ref(false)
const requestId = ref(crypto.randomUUID())
const busy = ref(false)
const error = ref<string | null>(null)
const sent = ref<{ issue: SentIssue; created: boolean } | null>(null)
const sheet = ref<HTMLDivElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)

const canSend = computed(() => online.value && !busy.value && title.value.trim().length > 0 && title.value.trim().length <= ISSUE_TITLE_MAX && body.value.length <= ISSUE_BODY_MAX)

function close(): void {
  if (!open.value) return
  open.value = false
  props.trigger?.focus()
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
watch(open, async (now) => {
  if (now) {
    sent.value = null
    error.value = null
    if (kind.value !== null && !props.kinds.some((k) => k.name === kind.value)) kind.value = null // the repo's kinds changed
    window.addEventListener('keydown', onKey)
    await nextTick()
    titleInput.value?.focus()
  } else {
    window.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function trapTab(e: KeyboardEvent): void {
  const items = [...(sheet.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, a[href]') ?? [])]
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

const pickKind = (name: string) => (kind.value = kind.value === name ? null : name)

async function send(): Promise<void> {
  if (!canSend.value) return
  busy.value = true
  error.value = null
  try {
    const out = await sendIssue({ repo: props.repo, title: title.value.trim(), body: body.value, kind: kind.value, requestId: requestId.value, askClaude: askClaude.value && props.claude === true })
    sent.value = out
    requestId.value = crypto.randomUUID()
    // An earlier try had landed: the fields may hold edits made since, which were not sent. Keep them, so the user decides
    // whether to send them as a new issue (the new id makes that a deliberate second send).
    if (out.created) {
      title.value = ''
      body.value = ''
      kind.value = null
      askClaude.value = false
    }
    emit('sent', out.issue)
  } catch (err) {
    // No answer may still mean GitHub made it: the same request id on retry finds it, so retrying is safe.
    error.value = err instanceof IntegrationsError && err.status === null
      ? 'No answer from the server. It may have been sent: Send again finds it rather than sending twice.'
      : err instanceof IntegrationsError ? err.message : String(err)
  } finally {
    busy.value = false
    // Send is disabled while busy (and stays so once the title clears): focus either drops to <body> or rests on a disabled
    // button, both out of the Tab trap. Bring it back to the title.
    await nextTick()
    const at = document.activeElement as HTMLButtonElement | null
    if (open.value && (!sheet.value?.contains(at) || at?.disabled)) titleInput.value?.focus()
  }
}
</script>

<template>
  <!-- In body: a card is its own stacking context, so a sheet inside it would sit under the next card. -->
  <Teleport to="body">
  <div v-if="open" class="scrim" data-test="issue-scrim" @click="close" />
  <div
    v-if="open" ref="sheet" class="sheet" role="dialog" aria-modal="true" :aria-label="`New issue in ${repo}`"
    data-test="issue-sheet" @keydown.tab="trapTab"
  >
    <button type="button" class="handle" aria-label="Close" data-test="issue-close" @click="close"><span /></button>
    <h3 class="font-semibold">New issue <span class="sub">· {{ repo }}</span></h3>

    <div v-if="sent" class="done" role="status" data-test="issue-sent">
      {{ sent.created ? 'Sent' : 'An earlier try had already landed' }}:
      <a v-if="githubLink(sent.issue.url)" :href="githubLink(sent.issue.url)!" target="_blank" rel="noopener noreferrer">#{{ sent.issue.number }} {{ sent.issue.title }}</a>
      <template v-if="!sent.created">. Any edits since then were not sent; they are still below.</template>
    </div>

    <form class="grid gap-2 min-w-0" autocomplete="off" @submit.prevent="send">
      <div v-if="kinds.length > 0" class="kinds" role="group" aria-label="Kind" data-test="issue-kinds">
        <button
          v-for="k in kinds" :key="k.name" type="button" class="chip" :class="{ on: kind === k.name }" :aria-pressed="kind === k.name"
          :data-test="`issue-kind-${k.name}`" @click="pickKind(k.name)"
        >{{ k.name }}</button>
      </div>
      <label class="label" for="issue-title">Title</label>
      <input
        id="issue-title" ref="titleInput" v-model="title" class="input" :maxlength="ISSUE_TITLE_MAX" required
        data-test="issue-title"
      />
      <label class="label" for="issue-body">Details <span class="sub">(optional)</span></label>
      <textarea id="issue-body" v-model="body" class="input" rows="5" :maxlength="ISSUE_BODY_MAX" data-test="issue-body" />
      <label v-if="claude === true" class="ask" data-test="issue-ask-claude">
        <input v-model="askClaude" type="checkbox" />
        <span>Ask Claude to work on it <span class="sub">(adds an @claude line; Claude replies on the issue with its work, merging stays yours)</span></span>
      </label>
      <div v-else class="help">
        <button type="button" class="link" :aria-expanded="helpOpen" data-test="issue-claude-help" @click="helpOpen = !helpOpen">
          {{ claude === null ? 'Could not tell if Claude is set up here' : 'Set up Claude for this repo' }} {{ helpOpen ? '▴' : '▾' }}
        </button>
        <ol v-if="helpOpen" class="steps" data-test="issue-claude-steps">
          <li>In Claude Code, inside this repo, run <code>/install-github-app</code>: it installs the Claude GitHub app and adds the workflow and its secret.</li>
          <li>Or by hand: add <code>.github/workflows/claude.yml</code> using <code>anthropics/claude-code-action</code>, and a repo secret <code>CLAUDE_CODE_OAUTH_TOKEN</code> from <code>claude setup-token</code>.</li>
          <li>Refresh this card: "Ask Claude to work on it" appears here. Only issues from people with write access start Claude.</li>
        </ol>
      </div>
      <p v-if="!isPrivate" class="text-xs text-warn" data-test="issue-public">{{ repo }} is public: this issue will be public.</p>
      <p v-if="error" class="text-sm text-err" role="alert" data-test="issue-error">{{ error }}</p>
      <div class="flex items-center gap-3">
        <button type="submit" class="btn-primary" :disabled="!canSend" data-test="issue-send">{{ busy ? 'Sending…' : 'Send to GitHub' }}</button>
        <span v-if="!online" class="sub">Offline: sending needs a connection.</span>
      </div>
    </form>
  </div>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / 0.35); }
.sheet {
  position: fixed; z-index: 51; left: 0; right: 0; bottom: 0; max-width: 32rem; margin: 0 auto;
  display: grid; gap: 0.6rem; max-height: 90dvh; overflow-y: auto;
  padding: 4px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0; background: rgb(var(--s-900)); color: rgb(var(--s-100));
}
.handle { justify-self: center; padding: 8px 24px 8px; }
.handle span { display: block; width: 36px; height: 4px; border-radius: 2px; background: rgb(var(--s-500)); }
.sub { font-size: 0.75rem; font-weight: 400; color: rgb(var(--s-400)); }
.kinds { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chip {
  min-height: 2.25rem; padding: 0.3rem 0.85rem; border-radius: 999px; font-size: 0.85rem;
  border: 1px solid var(--glass-btn-edge); background: transparent; color: inherit;
}
.chip.on { background: rgb(var(--s-100)); color: rgb(var(--s-900)); border-color: transparent; }
.done { font-size: 0.85rem; }
.ask { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.85rem; min-height: 2.75rem; padding-top: 0.6rem; }
.ask input { margin-top: 0.2rem; width: 1.1rem; height: 1.1rem; }
.link { font-size: 0.8rem; text-decoration: underline; text-underline-offset: 2px; color: rgb(var(--s-300)); min-height: 2.75rem; text-align: left; }
.steps { list-style: decimal; padding-left: 1.2rem; display: grid; gap: 0.35rem; font-size: 0.8rem; color: rgb(var(--s-300)); }
.steps code { font-size: 0.75rem; overflow-wrap: anywhere; }
.done a { text-decoration: underline; text-underline-offset: 2px; }
.text-warn { color: var(--glass-warn); }
.text-err { color: var(--glass-err); }
@media (prefers-reduced-motion: no-preference) {
  .sheet { animation: rise 160ms ease-out; }
  @keyframes rise { from { transform: translateY(100%); } }
}
</style>
