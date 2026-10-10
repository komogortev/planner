<script setup lang="ts">
// Non-prod only: a coloured strip across the top naming the environment. Prod renders nothing.
import { APP_ENV } from '@/env/applyEnvCue'
import { ENV_LOOK } from '@/env/appEnv'

const look = ENV_LOOK[APP_ENV]
</script>

<template>
  <div
    v-if="APP_ENV !== 'prod'"
    class="env-banner"
    :style="{ background: look.accent }"
    data-test="env-banner"
  >
    {{ look.label }}
  </div>
</template>

<style scoped>
.env-banner {
  color: #0f172a;
  font: 800 11px/1 system-ui, sans-serif;
  letter-spacing: 0.12em;
  text-align: center;
  padding: 4px 0;
  padding-top: max(4px, env(safe-area-inset-top));
}
</style>
