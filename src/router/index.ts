import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    // Financial screens: out of the nav (quiet base), reachable by URL only until the financial domain is deleted.
    {
      path: '/legacy',
      name: 'legacy-dashboard',
      component: () => import('@/views/LegacyDashboardView.vue'),
    },
    {
      path: '/commitments',
      name: 'commitments',
      component: () => import('@/views/CommitmentsView.vue'),
    },
    {
      path: '/intentions',
      name: 'intentions',
      component: () => import('@/views/IntentionsView.vue'),
    },
    {
      path: '/market',
      name: 'market',
      component: () => import('@/views/MarketView.vue'),
    },
    {
      path: '/categories',
      name: 'categories',
      component: () => import('@/views/CategoriesView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      // H1-S1 spike test screen — linked only from Settings, removed by S3.
      path: '/spike-auth',
      name: 'spike-auth',
      component: () => import('@/views/SpikeAuthView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})
