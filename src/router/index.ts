import { storedToken } from '@/auth/signIn'
import { createRouter, createWebHistory } from 'vue-router'

// Signed-out visitors see only the sign-in screen. The check is "is there a token" (works offline); a token the
// server rejects is cleared where /me is called (Settings), which sends the user back here.
// VITE_SKIP_AUTH=1 lets `pnpm dev` iterate on screens without the API (dev builds only).
const skipAuth = import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH === '1'

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
      path: '/signin',
      name: 'signin',
      meta: { public: true },
      component: () => import('@/views/SignInView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  if (skipAuth || to.meta.public) return true
  return storedToken() ? true : { name: 'signin' }
})
