import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const { adoptAccountModel, reconcileRunModel, clearRunWith, clearWaitingCall, dropStrandedRuns, executorFields, loadWaitingCall, markEnded, modelsKnown, opensOnArrival, runModel, runPath, saveWaitingCall, setRunModel } = await import('../runWith')

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

  it('several models and no choice: the first with a key (the oldest) is on by default (owner, 2026-10-13; D-113)', () => {
    reconcileRunModel([{ id: 'm0', label: 'No key', hasKey: false }, gemini, claude])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
    expect(JSON.parse(store.get('planner.run.model')!)).toEqual({ id: 'm1', label: 'Gemini' })
  })

  it('D-113: a device that picked "Copy and paste" before is migrated on load and adopts the account\'s model', async () => {
    store.set('planner.run.model', 'manual')
    vi.resetModules() // the stored choice is read when the module loads
    const fresh = await import('../runWith')
    expect(fresh.runModel.value).toBeNull()
    expect(store.has('planner.run.model')).toBe(false) // without the migration, adoption below would never ask
    await fresh.adoptAccountModel(async () => [gemini])
    expect(fresh.runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
  })

  it('a chosen model that is gone falls back to the only one left; a renamed one keeps the choice', () => {
    setRunModel({ id: 'm2', label: 'Claude' })
    reconcileRunModel([gemini])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
    reconcileRunModel([{ ...gemini, label: 'Gemini Flash' }, claude])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini Flash' })
  })

  it('a chosen model gone with nothing usable left: no model, and the device follows the account again', () => {
    setRunModel({ id: 'm2', label: 'Claude' })
    reconcileRunModel([])
    expect(runModel.value).toBeNull()
    expect(store.has('planner.run.model')).toBe(false)
  })

  it('the run panel asks the account once, only when the device has no choice; a failure leaves no model', async () => {
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

  it('no models: asked once per page load, not on every panel (nothing is stored to stop the next ask)', async () => {
    let calls = 0
    const list = async () => { calls++; return [] }
    await adoptAccountModel(list)
    await adoptAccountModel(list)
    expect(calls).toBe(1)
    expect(runModel.value).toBeNull()
  })

  it('several models: the panel adopts the first with a key', async () => {
    await adoptAccountModel(async () => [gemini, claude])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
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
    expect(opensOnArrival('harness', 'r1')).toBe(true) // known positive: a call in flight
    markEnded('harness', 'r1')
    expect(opensOnArrival('harness', 'r1')).toBe(false) // nothing is coming back
    expect(opensOnArrival('harness', 'r2')).toBe(true) // a newer run
    expect(opensOnArrival('widget', 'r1')).toBe(true) // per stage
    clearRunWith()
    expect(opensOnArrival('harness', 'r1')).toBe(true)
  })
})

describe('executorFields', () => {
  it('a run names its model and call (D-113: nothing writes copy-prompt)', () => {
    expect(executorFields({ modelId: 'm1', callId: 'c1' })).toEqual({ executor: 'model', modelId: 'm1', callId: 'c1' })
  })
})

describe('dropStrandedRuns (D-113): a run header is kept only while a model call for it may still answer', () => {
  const header = (runId: string) => JSON.stringify({ stage: 'harness', harnessVersion: 2, runId, composedAt: '2020-01-01T08:00:00.000Z', toAssessIds: [], contextIds: [], reevaluateIds: [], taskIds: [] })
  const HKEY = 'planner.run.pending.harness'
  const WKEY = 'planner.run.pending.widget'

  it('known positive: a header with its call waiting is kept', () => {
    store.set(HKEY, header('r1'))
    saveWaitingCall('harness', { callId: 'c1', modelId: 'm1', runId: 'r1' })
    expect(dropStrandedRuns()).toEqual([])
    expect(store.has(HKEY)).toBe(true)
  })

  it('a header with no call (a copied prompt from before D-113), or a call for another run, is cleared', () => {
    store.set(HKEY, header('r1'))
    expect(dropStrandedRuns()).toEqual(['harness'])
    expect(store.has(HKEY)).toBe(false)
    store.set(HKEY, header('r2'))
    saveWaitingCall('harness', { callId: 'c1', modelId: 'm1', runId: 'r1' })
    expect(dropStrandedRuns()).toEqual(['harness'])
  })

  it('a header whose call ended without a reply is cleared; any header shape counts, per stage', () => {
    store.set(HKEY, header('r1'))
    saveWaitingCall('harness', { callId: 'c1', modelId: 'm1', runId: 'r1' })
    markEnded('harness', 'r1')
    store.set(WKEY, JSON.stringify({ stage: 'widget', runId: 'old-v1', composedAt: 'x', entryIds: [] }))
    expect(dropStrandedRuns().sort()).toEqual(['harness', 'widget'])
    expect([store.has(HKEY), store.has(WKEY)]).toEqual([false, false])
  })

  it('nothing stored: nothing cleared', () => {
    expect(dropStrandedRuns()).toEqual([])
  })

  it('review R4-1: a header composed moments ago is kept without its call (another window may be starting it); older is not', () => {
    const at = Date.parse('2020-01-01T08:00:00.000Z') // the header's composedAt
    store.set(HKEY, header('r1'))
    expect(dropStrandedRuns(at + 30_000)).toEqual([])
    expect(store.has(HKEY)).toBe(true)
    expect(dropStrandedRuns(at + 121_000)).toEqual(['harness'])
  })
})

describe('runPath: no run without a model (D-113, alpha gap G1)', () => {
  const m = { id: 'm1', label: 'Gemini' }

  it('an account known to have no model is told to add a model', () => {
    expect(runPath(null, true)).toBe('needs-model')
  })

  it('models not read yet (offline, a failed request) is unknown, never "add a model" (CodeReview 1)', () => {
    expect(runPath(null, false)).toBe('unknown')
  })

  it('a model runs with the model, known or not', () => {
    expect(runPath(m, false)).toBe('model')
    expect(runPath(m, true)).toBe('model')
  })

  it('review R4-2: a "manual" written back after load (an older build in another window) does not stop the ask', async () => {
    store.set('planner.run.model', 'manual')
    await adoptAccountModel(async () => [{ id: 'm1', label: 'Gemini', hasKey: true }])
    expect(runModel.value).toEqual({ id: 'm1', label: 'Gemini' })
  })

  it('the models are known once a list arrives, stay unknown when the ask fails, and reset on sign-out', async () => {
    expect(modelsKnown.value).toBe(false)
    await adoptAccountModel(() => Promise.reject(new Error('offline')))
    expect(modelsKnown.value).toBe(false)
    await adoptAccountModel(async () => [])
    expect(modelsKnown.value).toBe(true)
    expect(runModel.value).toBeNull()
    clearRunWith()
    expect(modelsKnown.value).toBe(false)
  })
})
