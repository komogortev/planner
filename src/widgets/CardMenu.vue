<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { setWidgetTint, useWidgets } from './useWidgets'
import { TINTS, tintOf, tintOwners } from './tints'

// A widget's ⋯ menu (C4), the same on its live card and on its Widgets row: the card's own actions (slot, given `close`),
// then its colour. Horizontal dots like the rest of the app (Today's menu, the bottom band's More). The list is teleported
// to <body>, positioned under the button: inside a card it would sit in that card's stacking context, under the next card.
// A tint another widget wears stays selectable; the menu names who has it (soft duplicate marking, owner 2026-10-16).
const props = defineProps<{ widgetId: string; label: string }>()
const { looks, tintOf: currentTint } = useWidgets()

const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLDivElement | null>(null)
const pos = ref({ top: 0, right: 0 })
const error = ref<string | null>(null)
const listId = `card-menu-${props.widgetId}`

const tint = computed(() => currentTint(props.widgetId))
const owners = computed(() => tintOwners(looks.value, props.widgetId))
const taken = computed(() => TINTS.filter((t) => owners.value.has(t.id)).map((t) => `${t.name}: ${owners.value.get(t.id)!.join(', ')}`))

function place(): void {
  const r = button.value?.getBoundingClientRect()
  if (r) pos.value = { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }
}
function onOutside(e: PointerEvent): void {
  const t = e.target as Node
  if (!button.value?.contains(t) && !list.value?.contains(t)) close(false)
}
const onMove = () => close(false)
async function toggle(): Promise<void> {
  if (open.value) return close()
  place()
  error.value = null
  open.value = true
  document.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('resize', onMove)
  window.addEventListener('scroll', onMove, true)
  await nextTick()
  // Near the screen bottom, open upward: the list is fixed and any scroll closes it, so a clipped part could never be reached.
  const r = button.value?.getBoundingClientRect()
  const h = list.value?.offsetHeight ?? 0
  if (r && pos.value.top + h > window.innerHeight - 8) pos.value = { ...pos.value, top: Math.max(8, r.top - h - 4) }
  // The first enabled item: a disabled one (Refresh offline, Edit summary with no tasks) can't take focus, and focus left
  // on ⋯ would put the teleported list out of keyboard reach.
  list.value?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
}
function close(refocus = true): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('resize', onMove)
  window.removeEventListener('scroll', onMove, true)
  if (refocus) button.value?.focus()
}
onBeforeUnmount(() => close(false))

function onListKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { e.stopPropagation(); close() }
  // Teleported, the list is outside the card's tab order: Tab past its ends returns to the button.
  if (e.key === 'Tab') {
    const items = [...(list.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
    const edge = e.shiftKey ? items[0] : items[items.length - 1]
    if (document.activeElement === edge) { e.preventDefault(); close() }
  }
}

async function pick(id: string | null): Promise<void> {
  const r = await setWidgetTint(props.widgetId, id)
  if (!r.ok) error.value = r.error
}
</script>

<template>
  <button
    ref="button" type="button" class="btn-ghost btn-xs dots" :aria-label="label" aria-haspopup="dialog" :aria-expanded="open"
    :aria-controls="listId" :data-test="`card-menu-${widgetId}`" @click="toggle"
  >⋯</button>
  <Teleport to="body">
    <div
      v-if="open" :id="listId" ref="list" class="card-menu-list" :style="{ top: `${pos.top}px`, right: `${pos.right}px` }"
      :data-test="`card-menu-list-${widgetId}`" @keydown="onListKey"
    >
      <slot :close="close" />
      <div class="colour">
        <p class="head">Card colour</p>
        <div class="swatches" role="group" aria-label="Card colour">
          <button
            type="button" class="swatch none" :class="{ on: tint === null || !tintOf(tint) }" :aria-pressed="tint === null || !tintOf(tint)"
            aria-label="Default glass" title="Default glass" :data-test="`tint-none-${widgetId}`" @click="pick(null)"
          />
          <button
            v-for="t in TINTS" :key="t.id" type="button" class="swatch" :class="{ on: tint === t.id, taken: owners.has(t.id) }"
            :style="{ '--sw': t.rgb }" :aria-pressed="tint === t.id"
            :aria-label="owners.has(t.id) ? `${t.name}, also on ${owners.get(t.id)!.join(', ')}` : t.name"
            :title="owners.has(t.id) ? `${t.name}: also on ${owners.get(t.id)!.join(', ')}` : t.name"
            :data-test="`tint-${t.id}-${widgetId}`" @click="pick(t.id)"
          />
        </div>
        <p v-if="taken.length" class="taken-note" :data-test="`tint-taken-${widgetId}`">In use: {{ taken.join(' · ') }}</p>
        <p v-if="error" class="err" role="alert">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dots { font-size: 1rem; line-height: 1; padding: 0.3rem 0.55rem; }
.card-menu-list {
  position: fixed; z-index: 60; min-width: 12rem; max-width: min(18rem, calc(100vw - 16px)); padding: 4px;
  border-radius: 0.75rem; background: rgb(var(--s-900)); box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
}
.card-menu-list :slotted(button) {
  display: block; width: 100%; text-align: left; padding: 0.55rem 0.65rem; border-radius: 0.5rem; font-size: 0.85rem; color: rgb(var(--s-100));
}
.card-menu-list :slotted(button:hover:not(:disabled)) { background: rgb(var(--s-800)); }
.card-menu-list :slotted(button:disabled) { opacity: 0.5; }
.colour { padding: 0.4rem 0.65rem 0.5rem; border-top: 1px solid rgb(var(--s-800)); margin-top: 2px; }
.head { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgb(var(--s-400)); margin-bottom: 0.4rem; }
.swatches { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.swatch {
  position: relative; width: 1.9rem; height: 1.9rem; border-radius: 999px;
  background: rgb(var(--sw)); border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.25);
}
.swatch.none { background: var(--glass-bg); box-shadow: inset 0 0 0 1px var(--glass-edge); }
.swatch.on { border-color: rgb(var(--s-50)); }
/* Taken by another card: a small dark notch, not a block. */
.swatch.taken::after {
  content: ''; position: absolute; right: -2px; bottom: -2px; width: 0.6rem; height: 0.6rem; border-radius: 999px;
  background: rgb(var(--s-900)); box-shadow: inset 0 0 0 2px rgb(var(--s-300));
}
.taken-note { margin-top: 0.45rem; font-size: 0.72rem; color: rgb(var(--s-400)); }
.err { margin-top: 0.4rem; font-size: 0.75rem; color: var(--glass-err); }
</style>
