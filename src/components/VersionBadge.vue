<script setup lang="ts">
// Always-on build identity, every environment: small, semi-transparent, bottom centre. Never takes a tap
// (pointer-events: none), so it cannot block a control underneath.
import { APP_ENV } from '@/env/applyEnvCue'
import { BUILD, versionLabel } from '@/env/version'

const label = versionLabel(BUILD, APP_ENV)
</script>

<template>
  <div class="version-badge" :title="`built ${BUILD.builtAt}`" data-test="version-badge" aria-hidden="true">
    {{ label }}
  </div>
</template>

<style scoped>
.version-badge {
  position: fixed;
  left: 50%;
  bottom: max(6px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 50;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(2 6 23 / 0.55); /* slate-950 */
  color: rgb(203 213 225 / 0.75); /* slate-300 */
  font: 500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.02em;
}
</style>
