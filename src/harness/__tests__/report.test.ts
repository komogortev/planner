import { describe, expect, it } from 'vitest'
import { ageLabel, plainInline, reportLines } from '../report'

describe('reportLines — untrusted model text renders as plain lines', () => {
  it('reads a checklist, bullets, headings and depth', () => {
    expect(reportLines('## Today\n- [ ] call Sam\n  - [x] buy milk\n* note\n\nplain')).toEqual([
      { kind: 'heading', text: 'Today' },
      { kind: 'check', done: false, text: 'call Sam', depth: 0 },
      { kind: 'check', done: true, text: 'buy milk', depth: 1 },
      { kind: 'bullet', text: 'note', depth: 0 },
      { kind: 'text', text: 'plain' },
    ])
  })

  it('negative control: links lose their target, HTML stays literal text', () => {
    expect(plainInline('see [the doc](https://evil.example) and <https://evil.example>')).toBe('see the doc and https://evil.example')
    expect(reportLines('- [ ] <img src=x onerror=alert(1)>')[0]).toMatchObject({ text: '<img src=x onerror=alert(1)>' })
  })
})

describe('ageLabel', () => {
  it('minutes, hours, days', () => {
    const t = Date.parse('2026-10-11T12:00:00Z')
    expect(ageLabel('2026-10-11T11:55:00Z', t)).toBe('5 min ago')
    expect(ageLabel('2026-10-11T09:00:00Z', t)).toBe('3 h ago')
    expect(ageLabel('2026-10-10T12:00:00Z', t)).toBe('1 day ago')
  })
})
