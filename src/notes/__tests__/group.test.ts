import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { Entry } from '@/domain/entry'
import { dayKey, groupByDay } from '../group'
import NotesList from '../NotesList.vue'

const entry = (id: string, createdAt: string, body = id, over: Partial<Entry> = {}): Entry => ({
  id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, serverVersion: null, ...over,
})

describe('groupByDay', () => {
  it('lists newest first and starts a group at each day', () => {
    const groups = groupByDay([
      entry('a', '2026-10-09T09:00:00.000Z'), entry('c', '2026-10-10T18:00:00.000Z'), entry('b', '2026-10-10T08:00:00.000Z'),
    ], 'UTC')
    expect(groups.map((g) => g.day)).toEqual(['2026-10-10', '2026-10-09'])
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['c', 'b'])
  })

  // The same instant is two different days in two zones — the grouping must follow the zone it is given (D-23).
  it('puts a late-evening note on the local day, not the UTC day', () => {
    const iso = '2026-10-10T03:30:00.000Z'
    expect(dayKey(iso, 'UTC')).toBe('2026-10-10')
    expect(dayKey(iso, 'America/Toronto')).toBe('2026-10-09') // 23:30 the evening before
    expect(groupByDay([entry('x', iso)], 'America/Toronto')[0]!.day).toBe('2026-10-09')
  })

  it('leaves out a soft-deleted note, and breaks a time tie by id so the order is stable', () => {
    const t = '2026-10-10T10:00:00.000Z'
    const groups = groupByDay([entry('a', t), entry('b', t), entry('gone', t, 'x', { deletedAt: t })], 'UTC')
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('an empty list has no groups', () => {
    expect(groupByDay([], 'UTC')).toEqual([])
  })
})

describe('NotesList rendering (render escaping, H1-ENTRIES §10)', () => {
  const render = (entries: Entry[], unsynced: string[] = []) =>
    renderToString(createSSRApp({ render: () => h(NotesList, { groups: groupByDay(entries, 'UTC'), unsynced: new Set(unsynced), zone: 'UTC' }) }))

  // Negative control inside the test: the markup of a real row proves the component rendered something to inspect.
  it('shows a note’s text, and marks only the unsynced ones', async () => {
    const html = await render([entry('s', '2026-10-10T10:00:00.000Z', 'synced note'), entry('u', '2026-10-10T11:00:00.000Z', 'unsynced note')], ['u'])
    expect(html).toContain('synced note')
    expect(html.match(/data-test="note-unsynced"/g)).toHaveLength(1)
  })

  it('a body containing markup is text, never elements', async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const html = await render([entry('h', '2026-10-10T10:00:00.000Z', hostile)])
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img src=x onerror=')
  })
})
