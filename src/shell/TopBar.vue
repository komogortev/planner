<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { APP_ENV } from '@/env/applyEnvCue'
import MoreMenu from './MoreMenu.vue'
import { PAGES, pageIndex } from './pages'

// Layout A (D-117 test): a top app bar with the page name on a phone, the pages as tabs on a wide screen (the pager
// swipes by touch only), and the menu button, which opens the same menu as B's More, from the right. The bottom band
// keeps its dots in A. Shown only while this device has A chosen (navVariant, switched from the menu).
const route = useRoute()
const title = computed(() => PAGES[pageIndex(route.path)]?.label ?? '')
const open = ref(false)
const menuBtn = ref<HTMLButtonElement | null>(null)
</script>

<template>
  <!-- In prod nothing sits above the bar, so it clears the status bar itself (an installed iPhone app draws under it,
       viewport-fit=cover); elsewhere the environment banner above already does (CodeReview). -->
  <header class="top-bar" :class="{ 'top-inset': APP_ENV === 'prod' }" data-test="top-bar">
    <p class="title" data-test="top-bar-title">{{ title }}</p>
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
.title { font-size: 1.1rem; font-weight: 600; margin: 0; flex: 1; min-width: 0; }
.tabs { display: none; flex: 1; gap: 4px; }
.tab { padding: 6px 12px; border-radius: 8px; font-size: 0.875rem; color: var(--glass-sub); }
.tab:hover { color: var(--glass-text); }
.tab-on { color: var(--glass-text); background: var(--glass-btn-bg); box-shadow: inset 0 0 0 1px var(--glass-btn-edge); }
/* A wide screen gets the tabs instead of the title. The title is a <p>: the pages keep their own headings. */
@media (min-width: 768px) {
  .title { display: none; }
  .tabs { display: flex; }
}
.menu-btn { flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; color: var(--glass-text); }
.menu-btn:hover, .menu-btn[aria-expanded='true'] { background: var(--glass-btn-bg); }
.menu-btn svg { width: 22px; height: 22px; }
</style>
