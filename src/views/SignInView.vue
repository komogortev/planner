<script setup lang="ts">
import { lastResult, startSignIn } from '@/auth/signIn'
import bg from '@/assets/auth-bg.webp'

// First screen when not signed in (note 10). Invite-only: a rejected sign-in explains itself below the buttons.
const result = lastResult()
// Only a rejection from the attempt that just brought the user back here (not a stale one from days ago).
const rejected = result && result.text.startsWith('rejected') && Date.now() - result.at < 5 * 60_000 ? result.text : null
</script>

<template>
  <div class="signin" :style="{ backgroundImage: `linear-gradient(rgb(2 6 23 / 0.45), rgb(2 6 23 / 0.8)), url(${bg})` }">
    <div class="signin-body">
      <h1 class="text-3xl font-bold tracking-tight">Personal Planner</h1>
      <p class="text-sm text-slate-300 mt-2">Sign in to capture.</p>

      <div class="mt-10 flex flex-col gap-3 w-full max-w-xs">
        <button class="btn-primary justify-center py-3" data-test="signin-github" @click="startSignIn('github')">
          Continue with GitHub
        </button>
        <button class="btn-ghost justify-center py-3" data-test="signin-google" @click="startSignIn('google')">
          Continue with Google
        </button>
      </div>

      <p v-if="rejected" class="mt-6 text-sm text-rose-300 max-w-xs" data-test="signin-rejected">{{ rejected }}</p>
      <p class="mt-8 text-xs text-slate-400">Invite only.</p>
    </div>
  </div>
</template>

<style scoped>
.signin {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
  text-align: center;
  padding: 24px;
}
.signin-body {
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
