// D-55 as a structure test. The behaviour (a verdict only changes what is shown) is easy to state and easy to undo by one
// innocent line in a screen that happens to be mounted at launch — which is how a cold start came to wipe the device. So
// the rule is checked where it can break: the module that does the launch check imports nothing destructive, and the
// launch-time block of the Settings screen calls nothing destructive.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkAccount } from '../launchCheck'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** Code (comments stripped) of every `onMounted(async () => { … })` block in a Vue file. */
function onMountedBlocks(source: string): string[] {
  const blocks = source.match(/onMounted\(async \(\) => \{[\s\S]*?\n\}\)/g) ?? []
  return blocks.map((b) => b.replace(/\/\/.*$/gm, ''))
}

/** What may never be reached from a launch-time block: anything that signs out, clears or deletes. */
const DESTRUCTIVE = /\b(signOut|signOutSafely|signOutLocally|clearDeviceSafely|deleteMyAccount|clearAccountData|reset)\s*\(|\.(clear|delete|bulkDelete)\s*\(/

/** Imports of a module that could change the device's data. */
function destructiveImports(source: string): string[] {
  return [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]!).filter((from) => /(^|\/)(db|sync|account)(\/|$)/.test(from))
}

describe('checkAccount', () => {
  it('turns each verdict into a line to show, and never throws', async () => {
    expect(await checkAccount(async () => 'account-deleted')).toEqual({ error: 'this account was deleted' })
    expect(await checkAccount(async () => 'signed-out')).toEqual({ error: 'signed out of the server' })
    expect(await checkAccount(async () => ({ error: 'HTTP 500' }))).toEqual({ error: 'HTTP 500' })
    const me = { id: 'u1', email: 'a@example.com', name: null }
    expect(await checkAccount(async () => me)).toEqual(me)
  })
})

describe('the launch-time check cannot change the device (D-55)', () => {
  // Known positive: the scanners really see what they are meant to, so "found nothing" below cannot be a blind scan.
  it('the scanners flag the code that used to wipe the device on a cold start', () => {
    const old = `onMounted(async () => {\n  const r = await fetchMe()\n  if (r === 'signed-out') {\n    await signOut()\n    return\n  }\n})`
    expect(onMountedBlocks(old)).toHaveLength(1)
    expect(DESTRUCTIVE.test(onMountedBlocks(old)[0]!)).toBe(true)
    expect(destructiveImports(`import { signOutSafely } from '@/auth/account'\nimport { db } from '@/db'\nimport { ref } from 'vue'`)).toEqual(['@/auth/account', '@/db'])
  })

  it('SettingsView finds the blocks it is checked on (so the next test is not vacuous)', () => {
    expect(onMountedBlocks(read('../../views/SettingsView.vue')).length).toBeGreaterThan(0)
  })

  it('SettingsView calls nothing destructive from onMounted', () => {
    for (const block of onMountedBlocks(read('../../views/SettingsView.vue'))) {
      expect(block).not.toMatch(DESTRUCTIVE)
    }
  })

  it('launchCheck.ts imports nothing that can reach the device', () => {
    expect(destructiveImports(read('../launchCheck.ts'))).toEqual([])
  })
})
