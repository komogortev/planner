<script setup lang="ts">
// Always-on build identity, every environment and every page: small, semi-transparent, bottom centre. Never takes a
// tap (pointer-events: none), so it cannot block a control underneath.
// Owner rule (2026-10-10): visible on all pages, prod included, FOR NOW. Re-entry: the S4 cut-over (first live
// production use) — decide then whether prod keeps it.
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
  background: rgb(var(--s-950) / 0.55);
  color: rgb(var(--s-300) / 0.85);
  font: 500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.02em;
}
</style>
