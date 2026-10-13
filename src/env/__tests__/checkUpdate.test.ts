import { describe, expect, it } from 'vitest'
import { checkForUpdate, type UpdateDeps } from '../checkUpdate'

const deps = (o: Partial<UpdateDeps> & { updates?: { n: number } } = {}): UpdateDeps => ({
  current: 'aaa1111',
  deployed: async () => 'aaa1111',
  registration: async () => ({ update: async () => { if (o.updates) o.updates.n++; return undefined as never } }),
  ...o,
})

describe('checkForUpdate', () => {
  it('same commit as the deployed build: latest, and no fetch of a worker', async () => {
    const updates = { n: 0 }
    expect(await checkForUpdate(deps({ updates }))).toEqual({ kind: 'latest', commit: 'aaa1111' })
    expect(updates.n).toBe(0)
  })

  it('a newer deployed build: asks the worker to update (autoUpdate then reloads)', async () => {
    const updates = { n: 0 }
    expect(await checkForUpdate(deps({ deployed: async () => 'bbb2222', updates }))).toEqual({ kind: 'updating', commit: 'bbb2222' })
    expect(updates.n).toBe(1)
  })

  it('says why it cannot: offline, no worker, a failed fetch', async () => {
    expect((await checkForUpdate(deps({ deployed: async () => { throw new Error('x') } }))).kind).toBe('unavailable')
    expect((await checkForUpdate(deps({ deployed: async () => 'b', registration: async () => undefined }))).kind).toBe('unavailable')
    expect((await checkForUpdate(deps({ deployed: async () => 'b', registration: async () => ({ update: async () => { throw new Error('x') } }) }))).kind).toBe('unavailable')
  })
})
