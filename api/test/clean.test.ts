// The Worker uses the app's own rule set (src/domain/clean.ts) — one source, two runtimes. This proves it imports and
// behaves the same inside workerd; the rule-by-rule cases live in src/domain/__tests__/clean.test.ts.
import { describe, expect, it } from 'vitest'
import { cleanEntry } from '../../src/domain/clean'

describe('shared cleaning in workerd', () => {
  it('cleans and drops owner fields exactly as in the app', () => {
    const r = cleanEntry({
      id: '3F0C2A9E-5B1D-4C7A-9E2F-1A2B3C4D5E6F',
      body: 'café\r\nnote\u0000  ',
      createdAt: '2026-10-10T08:00:00.000Z',
      occurredAt: null,
      categoryId: null,
      tags: [],
      origin: 'author',
      updatedAt: '2026-10-10T08:00:00.000Z',
      deletedAt: null,
      user_id: 'someone-else',
    })
    expect(r).toEqual({
      ok: true,
      value: {
        id: '3f0c2a9e-5b1d-4c7a-9e2f-1a2b3c4d5e6f',
        body: 'café\nnote',
        createdAt: '2026-10-10T08:00:00.000Z',
        occurredAt: null,
        categoryId: null,
        tags: [],
        origin: 'author',
        updatedAt: '2026-10-10T08:00:00.000Z',
        deletedAt: null,
      },
    })
  })
})
