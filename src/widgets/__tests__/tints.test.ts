// C4: card tints. Unknown ids show the default glass; the menu names who else wears a tint.
import { describe, expect, it } from 'vitest'
import { cardTint, TINTS, tintOf, tintOwners } from '../tints'

describe('card tints', () => {
  it('a known id binds data-tint and --tint; unknown, null or absent binds nothing (default glass)', () => {
    expect(cardTint('teal')).toEqual({ 'data-tint': 'teal', style: { '--tint': '90 185 170' } })
    for (const id of ['aurora', null, undefined, '']) expect(cardTint(id), String(id)).toEqual({})
    expect(tintOf('deep-teal2')).toBeNull()
  })

  it('every listed tint id is one the record validator accepts', () => {
    for (const t of TINTS) expect(t.id).toMatch(/^[a-z][a-z0-9-]{0,23}$/)
    expect(new Set(TINTS.map((t) => t.id)).size).toBe(TINTS.length)
  })

  it('owners: other widgets per tint, self and unknown ids left out', () => {
    const looks = [
      { id: 'a', name: 'Planner', tint: 'teal' },
      { id: 'b', name: 'three-dbox', tint: 'teal' },
      { id: 'c', name: 'Today', tint: 'rose' },
      { id: 'd', name: 'Notes', tint: 'aurora' },
      { id: 'e', name: 'Summary', tint: null },
    ]
    const o = tintOwners(looks, 'a')
    expect([...o.entries()]).toEqual([['teal', ['three-dbox']], ['rose', ['Today']]])
  })
})
