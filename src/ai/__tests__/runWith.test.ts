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
const { clearRunWith, clearWaitingCall, executorFields, loadWaitingCall, runModel, saveWaitingCall, setRunModel } = await import('../runWith')

beforeEach(() => {
  store.clear()
  runModel.value = null
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

describe('executorFields', () => {
  it('a paste leaves the H5 keys out; a model run names both', () => {
    expect(executorFields()).toEqual({ executor: 'copy-prompt' })
    expect(executorFields({ modelId: 'm1', callId: 'c1' })).toEqual({ executor: 'model', modelId: 'm1', callId: 'c1' })
  })
})
