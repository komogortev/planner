<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { lastResult, startSignIn } from '@/auth/signIn'
import bg from '@/assets/auth-bg.webp'

// App gate (owner, 2026-10-10): the photo is a coat pocket; its button is the entry. Tapping the orange ring laid
// over the button opens the sign-in dialog. The ring is positioned in the photo's own coordinates (the stage below
// scales and shifts with the photo), so it stays on the button at every screen size.
const open = ref(false)

// Only a rejection from the attempt that just brought the user back here (not a stale one from days ago).
const result = lastResult()
const rejected = result && result.text.startsWith('rejected') && Date.now() - result.at < 5 * 60_000 ? result.text : null

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="gate">
    <!-- 1672x940 photo; button centre at (48.6%, 66.2%) of it. -->
    <div class="stage">
      <img :src="bg" alt="" class="photo" draggable="false" />
      <button class="ring" data-test="gate-button" aria-label="Sign in" @click="open = true" />
    </div>

    <p v-if="rejected" class="note" data-test="signin-rejected">{{ rejected }}</p>

    <div v-if="open" class="scrim" @click.self="open = false">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Sign in">
        <h2 class="text-lg font-bold">Sign in</h2>
        <p class="text-xs text-slate-400 mt-1">Invite only.</p>
        <div class="mt-5 flex flex-col gap-3">
          <button class="btn-primary justify-center py-3" data-test="signin-github" @click="startSignIn('github')">
            Continue with GitHub
          </button>
          <button class="btn-ghost justify-center py-3" data-test="signin-google" @click="startSignIn('google')">
            Continue with Google
          </button>
          <button class="text-xs text-slate-500 py-2" @click="open = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate {
  position: relative;
  height: 100%;
  min-height: 100%;
  overflow: hidden;
  background: #020100;
  container-type: size;
}
/* "Cover" with a focal point: the stage is at least the screen's size, keeps the photo's 1672:940 shape, and is
   shifted so the pocket button lands at the horizontal centre (clamped so no edge shows). */
.stage {
  --sw: max(100cqw, calc(100cqh * 1.7787));
  --sh: calc(var(--sw) * 0.5622);
  position: absolute;
  width: var(--sw);
  height: var(--sh);
  left: clamp(calc(100cqw - var(--sw)), calc(50cqw - 0.486 * var(--sw)), 0px);
  top: calc((100cqh - var(--sh)) / 2);
}
.photo {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}
.ring {
  position: absolute;
  left: 48.6%;
  top: 66.2%;
  width: max(5.6%, 52px); /* at least a thumb-sized target */
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgb(251 146 60);
  background: rgb(249 115 22 / 0.22);
  box-shadow: 0 0 18px rgb(249 115 22 / 0.65);
  cursor: pointer;
  animation: pulse 2.4s ease-in-out infinite;
}
.ring:active {
  background: rgb(249 115 22 / 0.45);
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 30px rgb(249 115 22 / 0.95);
    background: rgb(249 115 22 / 0.32);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ring {
    animation: none;
  }
}
.note {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 24px;
  text-align: center;
  font-size: 0.875rem;
  color: rgb(253 164 175);
  text-shadow: 0 1px 3px #000;
}
.scrim {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(2 6 23 / 0.6);
}
.dialog {
  width: 100%;
  max-width: 24rem;
  margin: 0 12px 16px;
  padding: 20px;
  border-radius: 20px;
  background: rgb(15 23 42);
  border: 1px solid rgb(51 65 85);
}
</style>
