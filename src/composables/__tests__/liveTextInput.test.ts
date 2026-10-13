import { describe, expect, it } from 'vitest'
import { installLiveTextInput, liveInput } from '../liveTextInput'

describe('liveTextInput', () => {
  it('clears the composing flag Vue sets at compositionstart, so v-model updates mid-word', () => {
    const field = { composing: true }
    liveInput({ target: field as unknown as EventTarget })
    expect(field.composing).toBe(false)
  })

  it('leaves a field that is not composing (and a missing target) alone', () => {
    const field: { composing?: boolean } = {}
    liveInput({ target: field as unknown as EventTarget })
    expect(field.composing).toBeUndefined()
    expect(() => liveInput({ target: null })).not.toThrow()
  })

  it('listens in the capture phase, so it runs before the field’s own v-model listener', () => {
    const calls: Array<[string, unknown, unknown]> = []
    installLiveTextInput({ addEventListener: (type: string, fn: unknown, opts: unknown) => void calls.push([type, fn, opts]) } as never)
    expect(calls).toEqual([['input', liveInput, true]])
  })
})
