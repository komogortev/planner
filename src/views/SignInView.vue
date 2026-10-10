<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { lastResult, startSignIn } from '@/auth/signIn'
import { computed } from 'vue'
import { activeTheme } from '@/theme/theme'
import bgDark from '@/assets/auth-bg.webp'
import bgLight from '@/assets/auth-bg-light.webp'

// Each theme has its own photo. `cx`/`cy`: the pocket button's centre as a fraction of the photo; `k`: photo width per
// ring width (sized so the button reads at ~45-50% of the ring); `cw`/`ch`: the least photo width, per screen width
// and per screen height, that still covers the screen with the button held at the ring (50%, 58%).
const PHOTOS = {
  dark: { src: bgDark, cx: 0.486, cy: 0.662, k: 19.44, cw: 1.029, ch: 2.209 },
  light: { src: bgLight, cx: 0.62, cy: 0.612, k: 17.1, cw: 1.316, ch: 1.925 },
} as const
const photo = computed(() => PHOTOS[activeTheme.value])
const gateVars = computed(() => ({
  '--cx': photo.value.cx, '--cyp': photo.value.cy, '--k': photo.value.k, '--cw': photo.value.cw, '--ch': photo.value.ch,
}))

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
  <div class="gate" :style="gateVars">
    <div class="stage">
      <img :src="photo.src" alt="" class="photo" draggable="false" />
    </div>
    <button class="ring" data-test="gate-button" aria-label="Sign in" @click="open = true" />

    <p v-if="rejected" class="note" data-test="signin-rejected">{{ rejected }}</p>

    <div v-if="open" class="scrim" @click.self="open = false">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Sign in">
        <h2 class="dialog-title">Sign in</h2>
        <p class="dialog-sub">Invite only.</p>
        <div class="mt-5 flex flex-col gap-3">
          <button class="glass-btn" data-test="signin-github" @click="startSignIn('github')">Continue with GitHub</button>
          <button class="glass-btn" data-test="signin-google" @click="startSignIn('google')">Continue with Google</button>
          <button class="dialog-cancel" @click="open = false">Cancel</button>
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
  background: rgb(var(--s-950));
  container-type: size;
}
/* Photo scale (per theme, see PHOTOS): large enough that its button matches the ring, and large enough to cover the
   screen with the button held at (50%, 58%) — the three terms are those constraints (button, width, height). */
.gate {
  --ring: 100px;
  --cy: 58cqh;
}
.stage {
  --sw: max(calc(var(--ring) * var(--k)), calc(100cqw * var(--cw)), calc(100cqh * var(--ch)));
  --sh: calc(var(--sw) * 0.5622);
  position: absolute;
  width: var(--sw);
  height: var(--sh);
  left: calc(50cqw - var(--cx) * var(--sw));
  top: calc(var(--cy) - var(--cyp) * var(--sh));
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
/* Frosted glass over the photo (from the owner's template): warm translucent dark, a hairline light edge, small
   corners, an outlined warm button. The photo stays visible through it — the scrim only dims a little. */
.scrim {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(0 0 0 / 0.22);
}
.dialog {
  --glass-text: #f4e8d6;
  --glass-sub: rgb(244 232 214 / 0.62);
  --glass-btn-edge: rgb(236 200 150 / 0.5);
  --glass-btn-bg: rgb(255 220 170 / 0.08);
  width: 100%;
  max-width: 24rem;
  margin: 0 12px 16px;
  padding: 22px 20px 14px;
  border-radius: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-edge);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.35);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  color: var(--glass-text);
}
:global(html[data-theme='light']) .dialog {
  --glass-text: #2a2119;
  --glass-sub: rgb(42 33 25 / 0.62);
  --glass-btn-edge: rgb(42 33 25 / 0.4);
  --glass-btn-bg: rgb(255 255 255 / 0.25);
}
.dialog-title {
  font: 500 1.25rem/1.2 ui-serif, Georgia, 'Times New Roman', serif;
  letter-spacing: 0.04em;
}
.dialog-sub {
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--glass-sub);
}
.glass-btn {
  width: 100%;
  padding: 13px 16px;
  border-radius: 8px;
  border: 1px solid var(--glass-btn-edge);
  background: var(--glass-btn-bg);
  color: var(--glass-text);
  font: 500 0.95rem/1 ui-serif, Georgia, 'Times New Roman', serif;
  letter-spacing: 0.03em;
  transition: background-color 120ms;
}
.glass-btn:active {
  background: rgb(255 220 170 / 0.22);
}
.dialog-cancel {
  padding: 10px 0;
  font-size: 0.75rem;
  color: var(--glass-sub);
}
</style>
