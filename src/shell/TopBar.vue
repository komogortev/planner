<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { APP_ENV } from '@/env/applyEnvCue'
import MoreMenu from './MoreMenu.vue'
import { PAGES } from './pages'

// Layout A (D-117 test): a top app bar with the app's name and icon, the pages as tabs on a wide screen (the pager swipes
// by touch only), and the menu button, which opens the same menu as B's More, from the right. The bar names the app, not
// the page: each page carries its own heading, which the bar repeated on a phone (owner, 2026-10-14). The bottom band
// keeps its dots in A. Shown only while this device has A chosen (navVariant, switched from the menu).
const icon = `${import.meta.env.BASE_URL}icon.svg`
const open = ref(false)
const menuBtn = ref<HTMLButtonElement | null>(null)
</script>

<template>
  <!-- In prod nothing sits above the bar, so it clears the status bar itself (an installed iPhone app draws under it,
       viewport-fit=cover); elsewhere the environment banner above already does (CodeReview). -->
  <header class="top-bar" :class="{ 'top-inset': APP_ENV === 'prod' }" data-test="top-bar">
    <p class="brand" data-test="top-bar-brand"><img :src="icon" alt="" class="brand-icon" width="24" height="24">Planner</p>
    <nav class="tabs" aria-label="Pages" data-test="top-bar-tabs">
      <RouterLink v-for="p in PAGES" :key="p.to" :to="p.to" class="tab" active-class="" exact-active-class="tab-on">{{ p.label }}</RouterLink>
    </nav>
    <button
      ref="menuBtn" type="button" class="menu-btn" aria-label="Menu" aria-haspopup="dialog" :aria-expanded="open"
      data-test="menu-open" @click="open = !open"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  </header>
  <MoreMenu v-model:open="open" placement="right" :trigger="menuBtn" />
</template>

<style scoped>
.top-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 48px;
  padding: 0 8px 0 20px;
  color: var(--glass-text);
  border-bottom: 1px solid var(--glass-edge);
}
.top-inset { height: calc(48px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top); }
/* The brand is a <p>: the pages keep their own headings. On a phone it takes the free width; next to the tabs, its own. */
.brand { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; font-weight: 600; margin: 0; flex: 1; min-width: 0; }
.brand-icon { flex: none; width: 24px; height: 24px; border-radius: 6px; }
.tabs { display: none; flex: 1; gap: 4px; }
.tab { padding: 6px 12px; border-radius: 8px; font-size: 0.875rem; color: var(--glass-sub); }
.tab:hover { color: var(--glass-text); }
.tab-on { color: var(--glass-text); background: var(--glass-btn-bg); box-shadow: inset 0 0 0 1px var(--glass-btn-edge); }
/* A wide screen adds the pages as tabs after the brand. */
@media (min-width: 768px) {
  .brand { flex: none; }
  .tabs { display: flex; }
}
.menu-btn { position: relative; flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; color: var(--glass-text); }
.menu-btn:hover, .menu-btn[aria-expanded='true'] { background: var(--glass-btn-bg); }
.menu-btn svg { width: 22px; height: 22px; }
/* The touch target is 48px (missed taps reported on the phone, owner 2026-10-14); the drawn button stays 40. */
.menu-btn::before { content: ''; position: absolute; inset: -4px; }
</style>
