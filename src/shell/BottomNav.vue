<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import MoreMenu from './MoreMenu.vue'
import { navVariant } from './navVariant'
import { PAGES, pageIndex } from './pages'

// The bottom band (D-117): always shown, no separator line. The page dots stay (the first is the capture page's
// microphone) and are links, so a mouse can change page too: the pager swipes by touch only, and this keeps one layout
// for phone and desktop. "More" (right, in a bubble so it is not lost on a busy page) opens a sheet from the bottom with
// actions a full page can bury (MoreMenu). In layout A (navVariant) the band keeps the dots and the top bar has the menu.
const route = useRoute()

const open = ref(false)
const moreBtn = ref<HTMLButtonElement | null>(null)
</script>

<template>
  <div class="band" data-test="nav-band">
    <nav class="dots" aria-label="Pages">
      <RouterLink
        v-for="(p, i) in PAGES"
        :key="p.to"
        :to="p.to"
        class="dot-link"
        :aria-label="p.label"
        :title="p.label"
        :data-test="`nav-dot-${i}`"
      >
        <!-- The first page is capture (Home, the dictophone), so its dot is a microphone of the same visual weight: an
             outline like the other dots' rings, filled with the theme's ink while it is the current page. -->
        <svg
          v-if="i === 0"
          class="mic"
          :class="{ 'mic-active': i === pageIndex(route.path) }"
          data-test="nav-mic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </svg>
        <span v-else class="dot" :class="{ 'dot-active': i === pageIndex(route.path) }" />
      </RouterLink>
    </nav>
    <button
      v-if="navVariant === 'b'" ref="moreBtn" type="button" class="more" aria-label="More" aria-haspopup="dialog" :aria-expanded="open"
      data-test="nav-more" @click="open = !open"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
    </button>
  </div>
  <MoreMenu v-if="navVariant === 'b'" v-model:open="open" placement="bottom" :trigger="moreBtn" />
</template>

<style scoped>
.band {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--nav-zone); /* page content never scrolls into it (Pager.vue) */
  z-index: 40;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-bottom: env(safe-area-inset-bottom); /* centred in the band, above the system gesture bar */
}
.dots {
  display: flex;
  align-items: center; /* the mic is taller than the rings: centre them on one line */
}
.dot-link {
  display: grid;
  place-items: center;
  width: 32px; /* the dots keep their spacing; the target is the band's full height around each (CodeReview) */
  height: 40px;
  border-radius: 10px;
}
.dot-link:focus-visible { outline: 2px solid rgb(var(--s-100) / 0.7); outline-offset: -4px; }
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid rgb(var(--s-200) / 0.65); /* s-200 is the light ink in dark theme and the dark ink in light: visible on both backdrops */
  transition: background-color 120ms, border-color 120ms;
}
.dot-active {
  background: rgb(var(--s-100)); /* the theme's ink: cream on dark, deep navy-teal on light */
  border-color: rgb(var(--s-100));
  box-shadow: 0 0 6px rgb(var(--s-100) / 0.35);
}
.mic {
  /* 14px tall against the dots' 9px: a glyph needs more room than a ring to read; its capsule is ~6px wide, the same
     visual weight. Colours follow the dots: the ring colour at rest, the theme ink and glow when current. */
  width: 14px;
  height: 14px;
  color: rgb(var(--s-200) / 0.65);
  transition: color 120ms, filter 120ms;
}
.mic-active {
  color: rgb(var(--s-100));
  filter: drop-shadow(0 0 3px rgb(var(--s-100) / 0.35));
}
.mic-active rect {
  fill: currentColor; /* the capsule fills like the active dot; the cradle and stem stay lines */
}
.more {
  position: absolute;
  right: 8px;
  bottom: env(safe-area-inset-bottom);
  width: 40px; /* the target; the bubble inside it is 32px */
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--glass-text);
}
.more svg {
  box-sizing: content-box;
  width: 18px;
  height: 18px;
  padding: 6px;
  border-radius: 999px;
  /* The bubble: the theme's outlined glass, so the button reads as one on any page (owner, 2026-10-14). */
  background: var(--glass-btn-bg);
  border: 1px solid var(--glass-btn-edge);
}
.more:focus-visible { outline: none; }
.more:focus-visible svg { box-shadow: 0 0 0 2px rgb(var(--s-100) / 0.7); }
</style>
