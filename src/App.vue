<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { computed } from 'vue'
import CleanupBanner from '@/components/CleanupBanner.vue'
import EnvBanner from '@/components/EnvBanner.vue'
import VersionBadge from '@/components/VersionBadge.vue'
import InstallButton from '@/components/InstallButton.vue'
import OnlineIndicator from '@/components/OnlineIndicator.vue'
import SyncStatusPill from '@/components/SyncStatusPill.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'

const route = useRoute()

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/commitments', label: 'Commitments' },
  { to: '/intentions', label: 'Intentions' },
  { to: '/market', label: 'Market Log' },
  { to: '/settings', label: 'Settings' },
] as const

const currentPath = computed(() => route.path)
</script>

<template>
  <!-- The shell is exactly one screen (h-dvh = the visible height on phones, browser bars excluded) and never
       scrolls; only <main> does. Nothing may be wider than the screen: an overflowing child makes mobile browsers
       zoom the whole page out, which pushed the fixed version badge far below the visible area. -->
  <div class="h-dvh flex flex-col overflow-hidden">
    <EnvBanner />
    <UpdateBanner />
    <CleanupBanner />

    <header
      class="app-header shrink-0 z-20 bg-slate-950 border-b border-slate-800"
    >
      <div class="max-w-5xl mx-auto w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sm:gap-4">
        <!-- min-w-0: let this group (and the nav in it) shrink below its content's width; the nav scrolls sideways. -->
        <div class="flex items-center gap-4 sm:gap-6 min-w-0 flex-1">
          <h1 class="text-base font-bold tracking-tight shrink-0">
            Personal Planner
          </h1>
          <nav class="flex items-center gap-1 overflow-x-auto min-w-0">
            <RouterLink
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="nav-link whitespace-nowrap"
              :class="{
                'nav-link-active':
                  item.to === '/'
                    ? currentPath === '/'
                    : currentPath.startsWith(item.to),
              }"
            >
              {{ item.label }}
            </RouterLink>
          </nav>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <SyncStatusPill />
          <InstallButton />
          <OnlineIndicator />
        </div>
      </div>
    </header>

    <!-- The only scrolling area. Bottom padding keeps the last line clear of the version badge. -->
    <main class="flex-1 min-h-0 overflow-y-auto pb-8">
      <RouterView />
    </main>

    <VersionBadge />
  </div>
</template>
