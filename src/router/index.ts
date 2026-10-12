import { storedToken } from '@/auth/signIn'
import { START_LOCATION, createRouter, createWebHistory } from 'vue-router'
import { landing, landingRedirect } from '@/shell/landing'

// Signed-out visitors see only the sign-in screen. The check is "is there a token" (works offline); a token the
// server rejects is cleared where /me is called (Settings), which sends the user back here.
// VITE_SKIP_AUTH=1 lets `pnpm dev` iterate on screens without the API (dev builds only).
const skipAuth = import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH === '1'

// Placeholder: the four main routes are drawn by the pager (App.vue).
const PagerPage = { render: () => null }

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PagerPage, // drawn by shell/Pager.vue; the router only owns the URL
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: PagerPage, // drawn by shell/Pager.vue; the router only owns the URL
    },
    {
      path: '/widgets',
      name: 'widgets',
      component: PagerPage, // drawn by shell/Pager.vue; the router only owns the URL
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
      component: PagerPage, // drawn by shell/Pager.vue; the router only owns the URL
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

router.beforeEach((to, from) => {
  if (skipAuth || to.meta.public) return firstLanding(to.path, from)
  return storedToken() ? firstLanding(to.path, from) : { name: 'signin' }
})

/** Opening the app lands on the page the owner chose (Settings → Opens on); later navigation is never redirected. */
function firstLanding(path: string, from: { matched: unknown[] }): true | string {
  if (from !== START_LOCATION) return true
  return landingRedirect(path, landing.value) ?? true
}
