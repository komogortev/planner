<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useOnline } from '@/composables/useOnline'
import { storedToken } from '@/auth/signIn'
import { ensureMorning } from '@/harness/scheduled'
import { listModels, ModelsError, outcomeText, type CallStatus } from './models'
import { listSchedules, saveMorning, type ScheduleView } from './schedules'

// Settings → Schedules (H5-S3-SCHEDULES D-124…D-129). One schedule at alpha: Morning, a harness run at a whole hour in this
// device's zone, started by the Worker while the app is closed. It uses the account's default model (Settings → AI models).
const online = useOnline()
const signedIn = storedToken() !== null // signing in or out leaves Settings, so read once
const schedule = ref<ScheduleView | null>(null)
const operatorPaused = ref(false)
const hasModel = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const saving = ref(false)

const hours = Array.from({ length: 24 }, (_, h) => ({ h, label: `${String(h).padStart(2, '0')}:00` }))
const pausedText = computed(() => {
  const why = schedule.value?.pausedReason
  return why ? `Paused after 3 failed runs in a row. ${outcomeText(why as CallStatus) ?? why}` : null
})
const lastRun = computed(() => (schedule.value?.lastDay ? `Last run started ${schedule.value.lastDay}.` : 'It has not run yet.'))

async function refresh(): Promise<void> {
  error.value = null
  try {
    await ensureMorning().catch(() => undefined) // on by default once a model exists (D-124)
    const r = await listSchedules()
    schedule.value = r.schedules.find((s) => s.kind === 'morning') ?? null
    operatorPaused.value = r.operatorPaused
    hasModel.value = (await listModels()).some((m) => m.hasKey)
  } catch (err) {
    error.value = err instanceof ModelsError ? err.message : String(err)
  } finally {
    loaded.value = true
  }
}
async function change(c: { hour?: number; enabled?: boolean }): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    schedule.value = await saveMorning(c)
  } catch (err) {
    error.value = err instanceof ModelsError ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
onMounted(() => { if (signedIn && online.value) void refresh(); else loaded.value = true })
</script>

<template>
  <section class="card" data-test="schedules-card">
    <h3 class="font-semibold mb-1">Schedules</h3>
    <p class="text-xs text-slate-500 mb-3">
      With a schedule on, the server sends your notes to your AI provider at the set hour while the app is closed, under the
      same terms as a manual run. The reply waits here until you open the app.
    </p>

    <p v-if="!signedIn || !online" class="text-sm text-slate-400" data-test="schedules-offline">Sign in and go online to manage schedules.</p>
    <template v-else>
      <p v-if="error" class="text-sm text-err" role="alert" data-test="schedules-error">{{ error }}</p>
      <p v-if="operatorPaused" class="text-xs text-warn mb-2" data-test="schedules-operator-paused">Schedules are paused for everyone while the service is checked.</p>
      <p v-if="loaded && !hasModel" class="text-xs text-warn mb-2" data-test="schedules-no-model">Add an AI model first: a schedule runs with your default model.</p>

      <div v-if="schedule" class="flex items-center justify-between gap-3" data-test="schedule-morning">
        <div class="min-w-0">
          <p class="text-sm font-semibold">Morning</p>
          <p class="text-xs text-slate-400" data-test="schedule-last">{{ lastRun }} Zone: {{ schedule.zone }}.</p>
          <p v-if="pausedText" class="text-xs text-warn mt-1" role="status" data-test="schedule-paused">{{ pausedText }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <select class="input" :value="schedule.hour" :disabled="saving" aria-label="Morning schedule hour" data-test="schedule-hour" @change="change({ hour: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="o in hours" :key="o.h" :value="o.h">{{ o.label }}</option>
          </select>
          <button class="btn-ghost btn-sm" :disabled="saving" :aria-pressed="schedule.enabled && !schedule.pausedReason" data-test="schedule-toggle" @click="change({ enabled: !(schedule.enabled && !schedule.pausedReason) })">
            {{ schedule.pausedReason ? 'Turn on again' : schedule.enabled ? 'On' : 'Off' }}
          </button>
        </div>
      </div>
      <p v-else-if="loaded" class="text-sm text-slate-400" data-test="schedule-none">No schedule yet. It is created when you have a model.</p>
    </template>
  </section>
</template>
