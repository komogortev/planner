// TEMPORARY — CI known positive for PR #20: this must turn the check red, then this commit is reverted.
import { expect, it } from 'vitest'

it('fails on purpose', () => {
  expect(1).toBe(2)
})
