<script setup lang="ts">
import { computed, ref } from 'vue'
import bgDark from '@/assets/auth-bg.webp'
import bgLight from '@/assets/auth-bg-light.webp'
import { activeTheme } from '@/theme/theme'
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

// The bar is the pocket's outside (owner, 2026-10-14): the sign-in page's photo is a coat pocket, entered through its
// button, so the app's header wears the same cloth — a plain patch of it, darkened, with a stitched seam along the bottom
// like the flap's edge. The photo is drawn at its own size (`w`, so the weave stays sharp; a bar wider than the photo shows the plain backing colour past its edge)
// and shifted so a patch of bare cloth, away from the pocket, the buttons and the face, sits under the bar (`x`/`y`, as
// background-position percentages: the plainest cloth window of 375x48 px on each photo, found by scanning its brightness).
const COVER = {
  dark: { src: bgDark, w: 1672, x: '72%', y: '52%' },
  light: { src: bgLight, w: 1366, x: '20%', y: '40%' },
} as const
const coverVars = computed(() => {
  const c = COVER[activeTheme.value]
  return { '--cover': `url(${c.src})`, '--cover-w': `${c.w}px`, '--cover-x': c.x, '--cover-y': c.y }
})
const menuBtn = ref<HTMLButtonElement | null>(null)
</script>

<template>
  <!-- In prod nothing sits above the bar, so it clears the status bar itself (an installed iPhone app draws under it,
       viewport-fit=cover); elsewhere the environment banner above already does (CodeReview). -->
  <header class="top-bar" :class="{ 'top-inset': APP_ENV === 'prod' }" :style="coverVars" data-test="top-bar">
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 48px;
  padding: 0 8px 0 20px;
  /* The cloth is dark in both themes, so the bar's text is light in both. */
  --bar-text: rgb(250 243 233);
  --bar-sub: rgb(250 243 233 / 0.68);
  color: var(--bar-text);
  background-color: rgb(28 22 17);
  background-image: linear-gradient(rgb(0 0 0 / 0.42), rgb(0 0 0 / 0.58)), var(--cover);
  background-size: auto, var(--cover-w) auto;
  background-position: 0 0, var(--cover-x) var(--cover-y);
  background-repeat: no-repeat;
  border-bottom: 1px solid rgb(0 0 0 / 0.55);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
  z-index: 1; /* its shadow falls on the pages below */
}
/* The seam: a stitched line along the bottom edge, as on the pocket flap. Drawn over the cloth, never over a tap. */
.top-bar::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 5px;
  border-bottom: 1.5px dashed rgb(255 225 180 / 0.32);
  pointer-events: none;
}
.top-inset { height: calc(48px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top); }
/* The brand is a <p>: the pages keep their own headings. On a phone it takes the free width; next to the tabs, its own. */
.brand { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; font-weight: 600; margin: 0; flex: 1; min-width: 0; }
.brand-icon { flex: none; width: 24px; height: 24px; border-radius: 6px; }
.tabs { display: none; flex: 1; gap: 4px; }
.tab { padding: 6px 12px; border-radius: 8px; font-size: 0.875rem; color: var(--bar-sub); }
.tab:hover { color: var(--bar-text); }
.tab-on { color: var(--bar-text); background: rgb(255 255 255 / 0.1); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18); }
/* A wide screen adds the pages as tabs after the brand. */
@media (min-width: 768px) {
  /* A wide bar spans more of the photo than its cloth (the wall, the collar): darker there, so it reads as texture. */
  .top-bar { background-image: linear-gradient(rgb(0 0 0 / 0.62), rgb(0 0 0 / 0.72)), var(--cover); }
  .brand { flex: none; }
  .tabs { display: flex; }
}
.menu-btn { position: relative; flex: none; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; color: var(--bar-text); }
.menu-btn:hover, .menu-btn[aria-expanded='true'] { background: rgb(255 255 255 / 0.1); }
.menu-btn svg { width: 22px; height: 22px; }
/* The touch target (missed taps reported on the phone, owner 2026-10-14; again "especially on the left side", same day): the
   drawn button stays 40, its hit area spans the bar's full height and reaches 20px to the left, across the gap to the brand,
   where a thumb aimed at the icon tends to land. Measured in the pane: every point of the bar right of x = button - 20 hits it. */
.menu-btn::before { content: ''; position: absolute; inset: -4px -4px -4px -20px; }
</style>
