<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSignOut } from '@/auth/useSignOut'
import { navVariant, setNavVariant } from './navVariant'

// The menu (D-117), the same in both layouts: B opens it from the bottom band's More, A from the top bar's menu button,
// as a sheet from the bottom or the right. Actions a full page can bury; opened by tap only (an edge swipe is Android's
// back gesture). It is modal: a scrim over the page, Tab wraps inside, and every close goes through `close()`, which
// hands focus back to the button that opened it.
const props = defineProps<{ placement: 'bottom' | 'right'; trigger: HTMLElement | null }>()
const open = defineModel<boolean>('open', { required: true })

const route = useRoute()
const router = useRouter()
const sheet = ref<HTMLDivElement | null>(null)
const firstItem = ref<HTMLButtonElement | null>(null)
const { signOut, blocked, draft, error } = useSignOut()

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
    blocked.value = null
    draft.value = false
    error.value = null
    window.addEventListener('keydown', onKey)
    await nextTick()
    firstItem.value?.focus()
  } else {
    window.removeEventListener('keydown', onKey)
  }
})
watch(() => route.path, close)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function trapTab(e: KeyboardEvent): void {
  const items = [...(sheet.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

// Close first: on Settings already, the push changes nothing and the route watcher would not fire.
function goSettings(): void {
  close()
  void router.push('/settings')
}
// The A/B switch (owner, 2026-10-14): the other layout replaces this menu's button, so focus goes to the new layout's
// menu button instead of falling to the page (CodeReview).
async function switchLayout(): Promise<void> {
  open.value = false
  setNavVariant(navVariant.value === 'a' ? 'b' : 'a')
  await nextTick()
  document.querySelector<HTMLElement>('[data-test="menu-open"], [data-test="nav-more"]')?.focus()
}
const doSignOut = () => void signOut() // on success the route changes and the sheet closes; otherwise it says why
</script>

<template>
  <div v-if="open" class="scrim" data-test="more-scrim" @click="close" />
  <div
    v-if="open" ref="sheet" class="sheet" :class="`sheet-${placement}`" role="dialog" aria-modal="true" aria-label="Menu"
    data-test="more-sheet" @keydown.tab="trapTab"
  >
    <button type="button" class="handle" aria-label="Close" data-test="more-close" @click="close"><span v-if="placement === 'bottom'" /><template v-else>✕</template></button>
    <button ref="firstItem" type="button" class="item" data-test="more-settings" @click="goSettings">Settings</button>
    <button type="button" class="item" data-test="more-layout" @click="switchLayout">
      {{ navVariant === 'a' ? 'Switch to the bottom menu (B)' : 'Switch to the top bar (A)' }}
    </button>
    <div v-if="placement === 'right'" class="grow" />
    <button type="button" class="item" data-test="more-sign-out" @click="doSignOut">Sign out</button>
    <p v-if="error" class="note err" role="alert" data-test="more-sign-out-error">{{ error }}</p>
    <p v-if="blocked !== null" class="note warn" role="alert" data-test="more-sign-out-blocked">
      <template v-if="blocked > 0">{{ blocked }} {{ blocked === 1 ? 'note has' : 'notes have' }} not reached the server. Signing out clears this device, so they would be lost. Let them sync first.</template>
      <template v-if="draft"> There is an unsent draft in the capture box. Capture it, or empty the box, first.</template>
    </p>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / 0.35); }
.sheet {
  position: fixed;
  z-index: 51;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgb(var(--s-900));
  color: rgb(var(--s-100));
}
.sheet-bottom {
  left: 0;
  right: 0;
  bottom: 0;
  max-width: 32rem;
  margin: 0 auto;
  padding: 4px 12px calc(16px + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0;
}
.sheet-right {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(80vw, 300px);
  padding: calc(8px + env(safe-area-inset-top)) 12px calc(16px + env(safe-area-inset-bottom));
}
.handle { align-self: center; padding: 8px 24px 12px; }
.handle span { display: block; width: 36px; height: 4px; border-radius: 2px; background: rgb(var(--s-500)); }
.sheet-right .handle { align-self: flex-end; padding: 12px; }
.sheet-right .handle { font-size: 1.1rem; line-height: 1; }
.item { text-align: left; padding: 12px; border-radius: 10px; font-size: 0.95rem; font-weight: 500; }
.item:hover, .item:focus-visible { background: rgb(var(--s-800)); outline: none; }
.grow { flex: 1; }
.note { font-size: 0.78rem; padding: 4px 12px 0; }
.warn { color: var(--glass-warn); }
.err { color: var(--glass-err); }
@media (prefers-reduced-motion: no-preference) {
  .sheet-bottom { animation: rise 160ms ease-out; }
  .sheet-right { animation: slide 160ms ease-out; }
  @keyframes rise { from { transform: translateY(100%); } }
  @keyframes slide { from { transform: translateX(100%); } }
}
</style>
