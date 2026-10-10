<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { lastResult, startSignIn } from '@/auth/signIn'
import bg from '@/assets/auth-bg.webp'

// App gate (owner, 2026-10-10): the photo is a coat pocket; its button is the entry. The screen decides, the photo
// follows: the orange ring is a fixed thumb-sized target at the screen's centre (a little below middle, like a
// fingerprint-scan template), and the photo is scaled and shifted so its pocket button sits under the ring.
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
    <div class="stage">
      <img :src="bg" alt="" class="photo" draggable="false" />
    </div>
    <button class="ring" data-test="gate-button" aria-label="Sign in" @click="open = true" />

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
/* Photo is 1672x940; its button has centre (48.6%, 66.2%) and a ~86px diameter (ring glow included). Photo scale:
   large enough that its button matches the ring, and large enough to cover the screen with the button held at
   (50%, 58%) — the three terms are those constraints (button, width, height). */
.gate {
  --ring: 100px;
  --cy: 58cqh;
}
.stage {
  --sw: max(calc(var(--ring) * 19.44), calc(100cqw * 1.029), calc(100cqh * 2.209));
  --sh: calc(var(--sw) * 0.5622);
  position: absolute;
  width: var(--sw);
  height: var(--sh);
  left: calc(50cqw - 0.486 * var(--sw));
  top: calc(var(--cy) - 0.662 * var(--sh));
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
  left: 50%;
  top: var(--cy);
  width: var(--ring);
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
