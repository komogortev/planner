// GitHub bridge G2, the app half: project widget records, their ids, and how a card turns GitHub text into plain blocks.
import { describe, expect, it } from 'vitest'
import { cleanRecord, flatten, restoreAbsent } from '@/domain/records'
import { projectWidgetId, projectWidgetRow, resolveProjectWidgets } from '../projects'
import { ageText, BRIEF_DEFAULT, briefBlocks, githubLink, segments, snapshotBlocks, snapshotFields } from '../projectView'

const NOW = '2026-10-16T10:00:00.000Z'
const errorsOf = (row: Record<string, unknown>) => {
  const c = cleanRecord('widget', { deletedAt: null, ...row })
  return c.ok ? [] : c.errors
}

describe('project widget records', () => {
  it('a project widget row validates, and names its repo', () => {
    const row = projectWidgetRow('komogortev/planner', false, true, NOW)
    expect(row).toMatchObject({ kind: 'project', active: true, name: 'planner', lens: null, project: { repo: 'komogortev/planner', private: false } })
    expect(errorsOf({ ...row })).toEqual([])
  })

  it('a project widget without a repo, and another kind with one, are refused', () => {
    const row = projectWidgetRow('komogortev/planner', false, true, NOW)
    expect(errorsOf({ ...row, project: null })).toEqual(['a project widget names its repo, the other kinds do not'])
    expect(errorsOf({ ...row, kind: 'system' })).toEqual(['a project widget names its repo, the other kinds do not'])
  })

  it('refuses a repo that is not owner/name', () => {
    const row = projectWidgetRow('komogortev/planner', false, true, NOW)
    for (const repo of ['planner', 'a/b/c', '-x/y', 'x/..', 'x/y z', `${'o'.repeat(40)}/y`]) {
      expect(errorsOf({ ...row, project: { repo, private: false } }), repo).toEqual(['project: repo is not a GitHub owner/name'])
    }
  })

  // Known positive for ADDED_FIELDS: an older build's system widget row has no `project` key, and it must stay valid and
  // stay without one; and its edit of a row that has one must not erase it.
  it("an older build's widget row is accepted with `project` absent, and an edit from it keeps the stored repo", () => {
    const older = { id: 'system-today', name: 'Today', kind: 'system', active: true, lens: null, lineage: null, createdAt: NOW, updatedAt: NOW, deletedAt: null }
    const c = cleanRecord('widget', older)
    expect(c.ok && c.value.absent).toEqual(['project'])
    expect(c.ok && flatten(c.value)).toEqual(older)
    const stored = projectWidgetRow('komogortev/planner', false, true, NOW)
    const { id: _i, ...storedFields } = stored
    const edit = cleanRecord('widget', { ...older, id: stored.id, name: stored.name, kind: 'project', active: false })
    expect(edit.ok).toBe(false) // a project row with its repo dropped is refused on its own…
    const kept = restoreAbsent({ recordKind: 'widget', id: stored.id, deletedAt: null, fields: { ...storedFields, active: false }, absent: ['project'] } as never, JSON.stringify(storedFields))
    expect(kept.ok && kept.value.fields.project).toEqual({ repo: 'komogortev/planner', private: false }) // …and the Worker restores it
  })

  it('ids are derived from the repo, case-insensitively, so two devices write one row', () => {
    expect(projectWidgetId('Komogortev/Planner')).toBe(projectWidgetId('komogortev/planner'))
    expect(projectWidgetId('komogortev/planner')).not.toBe(projectWidgetId('komogortev/planner-data'))
    expect(projectWidgetId('komogortev/planner')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('resolves only live project rows, in repo order, with their switch', () => {
    const a = projectWidgetRow('komogortev/zeta', true, false, NOW)
    const b = projectWidgetRow('komogortev/alpha', false, true, NOW)
    const gone = { ...projectWidgetRow('komogortev/gone', false, true, NOW), deletedAt: NOW }
    const system = { id: 'system-today', kind: 'system' as const, active: true, project: null }
    expect(resolveProjectWidgets([a, b, gone, system])).toEqual([
      { id: b.id, repo: 'komogortev/alpha', private: false, active: true },
      { id: a.id, repo: 'komogortev/zeta', private: true, active: false },
    ])
  })
})

describe('card text', () => {
  it('pairs ** into bold, keeps an unpaired ** as text, reduces links to their text', () => {
    expect(segments('**Working:** prod = Pages')).toEqual([{ text: 'Working:', bold: true }, { text: ' prod = Pages', bold: false }])
    expect(segments('a ** b')).toEqual([{ text: 'a ** b', bold: false }])
    expect(segments('see [RUNBOOK](RUNBOOK.md) and `pnpm check`')).toEqual([{ text: 'see RUNBOOK and pnpm check', bold: false }])
  })

  it('makes items of - and * lines, drops blank lines and heading marks', () => {
    expect(snapshotBlocks('- **Phase:** H1\n\n* two\n### Head\nplain')).toEqual([
      { kind: 'item', segments: [{ text: 'Phase:', bold: true }, { text: ' H1', bold: false }] },
      { kind: 'item', segments: [{ text: 'two', bold: false }] },
      { kind: 'line', segments: [{ text: 'Head', bold: false }] },
      { kind: 'line', segments: [{ text: 'plain', bold: false }] },
    ])
  })

  it('markup in a repo stays text: no block carries anything but text and a bold flag', () => {
    const blocks = snapshotBlocks('- <img src=x onerror=alert(1)> **<b>x</b>**')
    expect(blocks[0]!.segments.map((s) => s.text).join('')).toBe('<img src=x onerror=alert(1)> <b>x</b>')
    expect(Object.keys(blocks[0]!.segments[0]!)).toEqual(['text', 'bold'])
  })

  it('reads labelled fields: **Label:** and **Label**: both count; unlabelled and non-item lines are skipped', () => {
    const blocks = snapshotBlocks('- **Phase/Last:** H1 · **G2** live\n- **Next**: G4\n- plain item\n**Broken:** a line, not an item\n- **bold** no colon')
    expect(snapshotFields(blocks)).toEqual([
      { label: 'Phase/Last', segments: [{ text: 'H1 · ', bold: false }, { text: 'G2', bold: true }, { text: ' live', bold: false }] },
      { label: 'Next', segments: [{ text: 'G4', bold: false }] },
    ])
  })

  it('** inside inline code is text, so it neither unpairs the line nor hides its label', () => {
    expect(segments('**Next:** port `src/**/*.ts` now')).toEqual([{ text: 'Next:', bold: true }, { text: ' port src/**/*.ts now', bold: false }])
    expect(snapshotFields(snapshotBlocks('- **Next:** port `src/**/*.ts`')).map((f) => f.label)).toEqual(['Next'])
  })

  it('the brief picks the named fields in brief order, case-insensitively, and names the missing ones', () => {
    const blocks = snapshotBlocks('- **Phase:** H1\n- **Broken:** none\n- **Next:** G4')
    expect(briefBlocks(blocks, ['next', 'Broken', 'Blocker'])).toEqual({
      fields: [{ label: 'Next', segments: [{ text: 'G4', bold: false }] }, { label: 'Broken', segments: [{ text: 'none', bold: false }] }],
      missing: ['Blocker'],
    })
  })

  it('a snapshot with none of the brief fields still shows its first block; an empty one shows nothing', () => {
    const blocks = snapshotBlocks('Shipping the editor.\n- more')
    expect(briefBlocks(blocks, BRIEF_DEFAULT)).toEqual({ fields: [{ label: '', segments: [{ text: 'Shipping the editor.', bold: false }] }], missing: ['Next'] })
    expect(briefBlocks([], BRIEF_DEFAULT)).toEqual({ fields: [], missing: ['Next'] })
  })

  it('ages and links', () => {
    const t = Date.UTC(2026, 9, 16, 10)
    expect(ageText(t, t + 20_000)).toBe('just now')
    expect(ageText(t, t + 5 * 60_000)).toBe('5 min ago')
    expect(ageText(t, t + 3 * 3_600_000)).toBe('3 h ago')
    expect(ageText(t, t + 3 * 86_400_000)).toBe('3 days ago')
    expect(githubLink('https://github.com/komogortev/planner/pull/1')).toBe('https://github.com/komogortev/planner/pull/1')
    expect(githubLink('javascript:alert(1)')).toBeNull()
    expect(githubLink('https://github.com.evil.example/x')).toBeNull()
  })
})
