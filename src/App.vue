<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import EnvBanner from '@/components/EnvBanner.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import SyncBanner from '@/components/SyncBanner.vue'
import BottomNav from '@/shell/BottomNav.vue'
import TopBar from '@/shell/TopBar.vue'
import { navVariant } from '@/shell/navVariant'
import Pager from '@/shell/Pager.vue'
import { pageIndex } from '@/shell/pages'

const route = useRoute()
</script>

<template>
  <!-- One full screen (h-dvh), never scrolls itself. Nothing may be wider than the screen: an overflowing child makes
       mobile browsers zoom the page out. No header: the bottom band holds the page dots and More (D-117). The three main pages live
       in the pager (drag between them); every other route renders on its own. -->
  <div class="h-dvh flex flex-col overflow-hidden">
    <EnvBanner />
    <!-- Layout A of the D-117 test; B (the default) is the bottom band alone. -->
    <TopBar v-if="!route.meta.public && navVariant === 'a'" />
    <UpdateBanner />
    <SyncBanner v-if="!route.meta.public" />
    <Pager v-if="pageIndex(route.path) >= 0" class="flex-1 min-h-0" />
    <!-- pb-8 gives scrolling pages room at the end; the sign-in gate fills the screen, so it gets none (a 32 px strip of
         the app background showed under its photo, owner 2026-10-13). -->
    <main v-else class="flex-1 min-h-0 overflow-y-auto" :class="{ 'pb-8': !route.meta.public }">
      <RouterView />
    </main>
    <BottomNav v-if="!route.meta.public" />
  </div>
</template>
