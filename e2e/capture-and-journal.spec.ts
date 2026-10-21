// Alpha tester script rows T5 (capture) and T10 (get feedback), docs/ALPHA-TEST-PLAN.md §1. A real signed-in browser against a
// local Worker + app; the model is the stub provider (stubProvider.mjs), so no real provider or production is reached.
import { expect, test, type Page } from '@playwright/test'
import { STUB_URL, TEST_KEY, TEST_TOKEN } from './ports.mjs'

type Seen = { path: string; authorization: string; noteIds: string[] }
const seen = async (): Promise<Seen[]> => (await fetch(`${STUB_URL}/requests`)).json() as Promise<Seen[]>
const stub = (path: string, body?: unknown) => fetch(`${STUB_URL}${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

test.beforeEach(async ({ page }) => {
  await stub('/reset')
  // Signed in the way the app stores a sign-in (src/auth/signIn.ts TOKEN_KEY); the Worker has the matching seeded session.
  await page.addInitScript((t) => localStorage.setItem('planner.signIn.token', t), TEST_TOKEN)
})

async function capture(page: Page, text: string) {
  await page.goto('./') // a fresh install opens on the Dashboard (Settings → Opens on), so go to Home by the mic dot
  await page.getByTestId('nav-mic').click()
  await page.getByTestId('capture-input').fill(text)
  await page.getByTestId('capture-submit').click()
  await expect(page.getByTestId('capture-status')).toContainText('Saved')
}

test('T5: a captured note shows in Notes on the Dashboard and counts as today', async ({ page }) => {
  const text = `e2e note ${Date.now()}`
  await capture(page, text)
  await page.goto('dashboard')
  // Notes is a suggested widget: off until the account switches it on on the Widgets page (the tester script's T5 does not say so).
  await expect(page.getByTestId('notes-head')).toHaveCount(0)
  await page.goto('widgets')
  await page.getByTestId('widget-toggle-system-notes').click()
  await page.goto('dashboard')
  await expect(page.getByTestId('notes-head')).toBeVisible()
  await expect(page.getByTestId('notes-brief')).toContainText('1 today')
  await page.getByTestId('notes-toggle').click()
  await expect(page.getByTestId('note-body').filter({ hasText: text })).toHaveCount(1)
})

test('T10: Get feedback runs the stub model with the account key and stores a task and a question; no copy or paste', async ({ page }) => {
  await capture(page, 'e2e: the hall light is out')
  await capture(page, 'e2e: need a bulb for the hall')
  await page.goto('dashboard')
  await page.getByTestId('strip-feedback').click()
  await page.getByTestId('run-model').click()
  // A valid reply is stored by itself (D-103): there is no Store step and nothing to paste.
  await expect(page.getByTestId('run-done')).toContainText('Stored: 1 task touched, 1 question')

  // The provider was reached once, with this account's key, and was shown both notes.
  const calls = await seen()
  expect(calls).toHaveLength(1)
  expect(calls[0]!.authorization).toBe(`Bearer ${TEST_KEY}`)
  expect(calls[0]!.noteIds.length).toBeGreaterThanOrEqual(2)

  await expect(page.getByTestId('daily-task').filter({ hasText: 'E2E task from the stub provider' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /copy|paste/i })).toHaveCount(0)
})

test('T10 negative control: a reply that is not the harness JSON stores nothing and leaves no task', async ({ page }) => {
  await stub('/mode', { mode: 'bad' })
  await capture(page, 'e2e: a note the bad reply must not turn into a task')
  await page.goto('dashboard')
  await page.getByTestId('strip-feedback').click()
  await page.getByTestId('run-model').click()
  await expect.poll(async () => (await seen()).length).toBe(1) // the model was called: the refusal below is about the reply
  await expect(page.getByTestId('run-done')).toHaveCount(0)
  await expect(page.getByTestId('daily-task')).toHaveCount(0)
  await expect(page.getByTestId('run-step')).toContainText(/could not|not valid|read|reply/i)
})
