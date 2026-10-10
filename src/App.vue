<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import EnvBanner from '@/components/EnvBanner.vue'
import VersionBadge from '@/components/VersionBadge.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import BottomNav from '@/shell/BottomNav.vue'
import Pager from '@/shell/Pager.vue'
import { pageIndex } from '@/shell/pages'

const route = useRoute()
</script>

<template>
  <!-- One full screen (h-dvh), never scrolls itself. Nothing may be wider than the screen: an overflowing child makes
       mobile browsers zoom the page out. No header: the bottom bar is hidden until touched. The three main pages live
       in the pager (drag between them); every other route renders on its own. -->
  <div class="h-dvh flex flex-col overflow-hidden">
    <EnvBanner />
    <UpdateBanner />
    <Pager v-if="pageIndex(route.path) >= 0" class="flex-1 min-h-0" />
    <main v-else class="flex-1 min-h-0 overflow-y-auto pb-8">
      <RouterView />
    </main>
    <BottomNav v-if="!route.meta.public" />
    <VersionBadge />
  </div>
</template>
