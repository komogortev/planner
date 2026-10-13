import { beforeEach, describe, expect, it } from 'vitest'

// The suite runs in node: a minimal localStorage, installed before the module reads it.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})
const { adoptAccountModel, reconcileRunModel, clearRunWith, clearWaitingCall, executorFields, loadWaitingCall, markEnded, opensOnArrival, runModel, saveWaitingCall, setRunModel } = await import('../runWith')

beforeEach(() => {
  clearRunWith() // also resets the once-per-page-load ask
  store.clear()
})

describe('the device’s model choice', () => {
  it('is remembered with its label and cleared with the account', () => {
    setRunModel({ id: 'm1', label: 'Gemini' })
    expect(JSON.parse(store.get('planner.run.model')!)).toEqual({ id: 'm1', label: 'Gemini' })
    saveWaitingCall('harness', { callId: 'c1', modelId: 'm1', runId: 'r1' })
    clearRunWith()
    expect(runModel.value).toBeNull()
    expect(store.size).toBe(0)
  })
})

describe('the account’s model on a device that never chose (D-102)', () => {
  const gemini = { id: 'm1', label: 'Gemini', hasKey: true }
  const claude = { id: 'm2', label: 'Claude', hasKey: true }

  it('a device with no choice runs with the only model that has a key, and remembers it', () => {
    reconcileRunModel([gemini, { id: 'm3', label: 'No key', hasKey: false }])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
    expect(JSON.parse(store.get('planner.run.model')!)).toEqual({ id: 'm1', label: 'Gemini' })
  })

  it('several models and no choice: copy and paste until the owner picks one', () => {
    reconcileRunModel([gemini, claude])
    expect(runModel.value).toBeNull()
    expect(store.has('planner.run.model')).toBe(false)
  })

  it('"Copy and paste" picked on this device is never overridden', () => {
    setRunModel(null)
    expect(store.get('planner.run.model')).toBe('manual')
    reconcileRunModel([gemini])
    expect(runModel.value).toBeNull()
  })

  it('a chosen model that is gone falls back to the only one left; a renamed one keeps the choice', () => {
    setRunModel({ id: 'm2', label: 'Claude' })
    reconcileRunModel([gemini])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
    reconcileRunModel([{ ...gemini, label: 'Gemini Flash' }, claude])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini Flash' })
  })

  it('a chosen model gone with nothing usable left: copy and paste, and the device follows the account again', () => {
    setRunModel({ id: 'm2', label: 'Claude' })
    reconcileRunModel([])
    expect(runModel.value).toBeNull()
    expect(store.has('planner.run.model')).toBe(false)
  })

  it('the run panel asks the account once, only when the device has no choice; a failure leaves copy and paste', async () => {
    let calls = 0
    const list = async () => { calls++; return [gemini] }
    await Promise.all([adoptAccountModel(list), adoptAccountModel(list)])
    expect(calls).toBe(1)
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
    await adoptAccountModel(list) // chosen now: no request
    expect(calls).toBe(1)
    clearRunWith()
    await adoptAccountModel(async () => { throw new Error('offline') })
    expect(runModel.value).toBeNull()
  })

  it('several models: asked once per page load, not on every panel', async () => {
    let calls = 0
    const list = async () => { calls++; return [gemini, claude] }
    await adoptAccountModel(list)
    await adoptAccountModel(list)
    expect(calls).toBe(1)
    expect(runModel.value).toBeNull()
  })

  it('an answer that arrives after sign-out is dropped', async () => {
    let release!: (v: typeof gemini[]) => void
    const pending = adoptAccountModel(() => new Promise((r) => { release = r }))
    clearRunWith()
    release([gemini])
    await pending
    expect(runModel.value).toBeNull()
    expect(store.has('planner.run.model')).toBe(false)
  })

  it('"Copy and paste" picked while the account is being asked stays picked', async () => {
    let release!: (v: typeof gemini[]) => void
    const pending = adoptAccountModel(() => new Promise((r) => { release = r }))
    setRunModel(null)
    release([gemini])
    await pending
    expect(runModel.value).toBeNull()
    expect(store.get('planner.run.model')).toBe('manual')
  })
})

describe('waiting calls', () => {
  it('round-trip per stage; a malformed value is ignored', () => {
    saveWaitingCall('harness', { callId: 'c1', modelId: 'm1', runId: 'r1' })
    expect(loadWaitingCall('harness')).toEqual({ callId: 'c1', modelId: 'm1', runId: 'r1' })
    expect(loadWaitingCall('widget')).toBeNull()
    store.set('planner.run.call.widget', '{"callId":1}')
    expect(loadWaitingCall('widget')).toBeNull()
    store.set('planner.run.call.widget', 'not json')
    expect(loadWaitingCall('widget')).toBeNull()
    clearWaitingCall('harness')
    expect(loadWaitingCall('harness')).toBeNull()
  })
})

describe('opensOnArrival', () => {
  it('a waiting run opens, unless a model call for that very run ended without a reply', () => {
    expect(opensOnArrival('harness', null)).toBe(false)
    expect(opensOnArrival('harness', 'r1')).toBe(true) // known positive: a copied prompt, or a call in flight
    setRunModel({ id: 'm1', label: 'Gemini' })
    expect(opensOnArrival('harness', 'r1')).toBe(true) // "Copy instead" on a device with a model (CodeReview L2)
    markEnded('harness', 'r1')
    expect(opensOnArrival('harness', 'r1')).toBe(false) // nothing is coming back
    expect(opensOnArrival('harness', 'r2')).toBe(true) // a newer run
    expect(opensOnArrival('widget', 'r1')).toBe(true) // per stage
    clearRunWith()
    expect(opensOnArrival('harness', 'r1')).toBe(true)
  })
})

describe('executorFields', () => {
  it('a paste leaves the H5 keys out; a model run names both', () => {
    expect(executorFields()).toEqual({ executor: 'copy-prompt' })
    expect(executorFields({ modelId: 'm1', callId: 'c1' })).toEqual({ executor: 'model', modelId: 'm1', callId: 'c1' })
  })
})
