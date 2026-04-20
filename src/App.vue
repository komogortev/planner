<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { computed } from 'vue'
import OnlineIndicator from '@/components/OnlineIndicator.vue'
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
  <div class="min-h-screen flex flex-col">
    <UpdateBanner />

    <header
      class="sticky top-0 z-20 backdrop-blur-sm bg-slate-950/80 border-b border-slate-800"
    >
      <div class="max-w-5xl mx-auto w-full px-6 py-3 flex items-center justify-between gap-4">
        <div class="flex items-center gap-6">
          <h1 class="text-base font-bold tracking-tight">
            Personal Planner
          </h1>
          <nav class="flex items-center gap-1 overflow-x-auto">
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
        <OnlineIndicator />
      </div>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
