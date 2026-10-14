<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

// A6 (D-118): mounted INSTEAD of the app when this build is older than the data on this device (src/db/staleBuild.ts).
// Nothing here opens the database or syncs: the notes stay exactly as the newer build left them.
//
// Getting the newer build: this screen does not mount the app's update banner (usePwaUpdate), so it asks the service worker
// itself. A plain reload would be served from the old precache (CodeReview). The service worker is autoUpdate (it takes
// over as soon as it is installed), so a takeover reloads into the newer build; it is checked on open too, because an
// installed app resumed from the background never navigates.
const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
const onTakeover = () => location.reload()

async function checkForUpdate(): Promise<boolean> {
  try {
    const reg = await sw?.getRegistration()
    if (!reg) return false
    await reg.update()
    return !!(reg.installing || reg.waiting)
  } catch {
    return false
  }
}

async function reopen() {
  // An update on its way reloads on takeover; give it a few seconds, then reload anyway.
  if (await checkForUpdate()) setTimeout(() => location.reload(), 4_000)
  else location.reload()
}

onMounted(() => {
  sw?.addEventListener('controllerchange', onTakeover)
  void checkForUpdate()
})
onBeforeUnmount(() => sw?.removeEventListener('controllerchange', onTakeover))
</script>

<template>
  <div class="h-dvh flex items-center justify-center px-6" data-test="stale-build">
    <div class="card max-w-sm w-full text-center">
      <h1 class="text-lg font-bold">Please update the app</h1>
      <p class="text-sm mt-3">This copy of the app is older than the notes saved on this device, so it has not opened them.</p>
      <p class="text-sm mt-2">Your notes are safe on this device. Do not clear the app's data: notes that have not synced yet live only here. Reopen in a few minutes.</p>
      <button type="button" class="btn-primary mt-6" data-test="stale-build-reopen" @click="reopen">Reopen</button>
    </div>
  </div>
</template>
