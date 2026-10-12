<script setup lang="ts">
import { landing, setLanding, type Landing } from '@/shell/landing'
import { setThemeChoice, themeChoice, type ThemeChoice } from '@/theme/theme'

// This device's preferences: where the app opens (calibration 2026-10-12, default Dashboard) and the theme. Both live in
// localStorage, per device.
const landingOptions: { value: Landing; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'record', label: 'Record' },
]
const themeOptions: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
</script>

<template>
  <section class="card">
    <h3 class="font-semibold mb-1">Opens on</h3>
    <p class="text-xs text-slate-500 mb-3">The page the app starts on: your tasks first, or the recorder first.</p>
    <div class="choice" role="radiogroup" aria-label="Opens on">
      <button
        v-for="o in landingOptions"
        :key="o.value"
        role="radio"
        :aria-checked="landing === o.value"
        class="opt"
        :class="{ 'opt-on': landing === o.value }"
        :data-test="`landing-${o.value}`"
        @click="setLanding(o.value)"
      >
        {{ o.label }}
      </button>
    </div>

    <h3 class="font-semibold mt-6 mb-3">Appearance</h3>
    <div class="choice" role="radiogroup" aria-label="Theme">
      <button
        v-for="o in themeOptions"
        :key="o.value"
        role="radio"
        :aria-checked="themeChoice === o.value"
        class="opt"
        :class="{ 'opt-on': themeChoice === o.value }"
        :data-test="`theme-${o.value}`"
        @click="setThemeChoice(o.value)"
      >
        {{ o.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.choice {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: rgb(var(--s-800));
}
.opt {
  flex: 1;
  padding: 8px 0;
  border-radius: 9px;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--s-400));
}
.opt-on {
  background: rgb(var(--s-950));
  color: rgb(var(--s-100));
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}
</style>
