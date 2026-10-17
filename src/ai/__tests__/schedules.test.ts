import { describe, expect, it } from 'vitest'
import { toggleLabel } from '../schedules'

describe('toggleLabel (the Morning toggle)', () => {
  it('known positive: on, nothing paused, reads On', () => {
    expect(toggleLabel({ enabled: true, pausedReason: null }, false)).toBe('On')
  })
  it('the operator brake says so while the switch is on', () => {
    expect(toggleLabel({ enabled: true, pausedReason: null }, true)).toBe('On (paused by the service)')
  })
  it('off stays Off under the brake: nothing to explain', () => {
    expect(toggleLabel({ enabled: false, pausedReason: null }, true)).toBe('Off')
  })
  it('the schedule\'s own pause wins: the action is Turn on again', () => {
    expect(toggleLabel({ enabled: true, pausedReason: 'key_rejected' }, true)).toBe('Turn on again')
    expect(toggleLabel({ enabled: true, pausedReason: 'key_rejected' }, false)).toBe('Turn on again')
  })
})
