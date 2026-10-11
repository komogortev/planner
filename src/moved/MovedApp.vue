<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearDeviceSafely, localCopy } from '@/auth/account'
import { downloadJson } from '@/utils/download'
import { movedFacts, onlyHereWarning, type MovedFacts } from './movedFacts'

defineProps<{ to: string }>()

const facts = ref<MovedFacts | null>(null)
const busy = ref(false)
const message = ref('')
const copyName = () => `planner-device-copy-${new Date().toISOString().slice(0, 10)}.json`

const refresh = async () => { facts.value = await movedFacts() }
onMounted(() => { void refresh() })

async function saveCopy(): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    downloadJson(copyName(), await localCopy())
    message.value = 'Downloaded. Check your downloads folder before clearing anything.'
  } catch (err) {
    message.value = `No copy was made: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    busy.value = false
  }
}

// The same guarded clear as everywhere else (D-50, D-55): names every note, downloads a copy first, re-checks the device,
// and ends the sign-in too (`dropToken`) — this address is not the one to be signed in at any more.
async function clearDevice(): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    const out = await clearDeviceSafely(
      { confirm: (m) => window.confirm(m), saveCopy: (copy) => downloadJson(copyName(), copy) },
      { dropToken: true },
    )
    message.value =
      out === 'cleared' ? 'This device is cleared.' : out === 'changed' ? 'Something changed on this device while the copy was made, so nothing was cleared. Try again.' : ''
    await refresh()
  } catch (err) {
    message.value = `Nothing was cleared: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="min-h-dvh grid place-items-center p-6">
    <div class="w-full max-w-md space-y-5" data-test="moved">
      <h1 class="text-xl font-semibold">Planner moved</h1>
      <p>
        The app now lives at
        <a :href="to" class="underline [overflow-wrap:anywhere]" data-test="moved-link">{{ to }}</a>.
        Open it, sign in, and your notes are there. This old address no longer syncs anything.
      </p>

      <section v-if="facts" class="space-y-2" data-test="moved-facts">
        <p v-if="facts.notes > 0 || facts.unsynced > 0 || facts.draft">
          This device still holds {{ facts.notes }} {{ facts.notes === 1 ? 'note' : 'notes' }}.
        </p>
        <p v-else>This device holds no notes.</p>
        <p v-if="onlyHereWarning(facts)" class="font-semibold" data-test="moved-warning">{{ onlyHereWarning(facts) }}</p>
      </section>

      <div class="flex flex-wrap gap-3">
        <a :href="to" class="btn-primary" data-test="moved-open">Open the new app</a>
        <button class="btn-ghost" :disabled="busy" data-test="moved-save" @click="saveCopy">Save a copy of this device's notes</button>
        <button class="btn-danger" :disabled="busy" data-test="moved-clear" @click="clearDevice">Clear this device</button>
      </div>

      <p v-if="message" role="status" data-test="moved-message">{{ message }}</p>
      <p class="text-sm opacity-70">
        Clearing removes this device's notes and its sign-in. Your notes on the server are not touched.
      </p>
    </div>
  </main>
</template>
