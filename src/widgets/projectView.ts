// How a project card shows GitHub text (docs/GITHUB-BRIDGE.md §6). Environment-free. GitHub content is data, never markup:
// a STATE snapshot becomes plain blocks of text segments, with bold kept and links reduced to their text. Nothing here
// produces HTML, so nothing a repo writes can run in the app.

export interface Segment { text: string; bold: boolean }
export interface Block { kind: 'item' | 'line'; segments: Segment[] }

/** `[text](url)` → `text`; inline code ticks dropped. */
const plain = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1')

/** Stands in for `**` inside inline code while a line is split, so a code span's `**` is never a bold marker. */
const CODE_STARS = '\u0000'

/** One line's segments: `**bold**` pairs become bold segments; an unpaired `**` stays as text. */
export function segments(line: string): Segment[] {
  const out: Segment[] = []
  const guarded = line.replace(/`[^`]*`/g, (code) => code.split('**').join(CODE_STARS))
  const parts = plain(guarded).split('**').map((p) => p.split(CODE_STARS).join('**'))
  const paired = parts.length % 2 === 1 // an odd count of parts means every ** has a partner
  parts.forEach((p, i) => {
    const bold = paired && i % 2 === 1
    if (!paired && i > 0) out.push({ text: '**', bold: false })
    if (p) out.push({ text: p, bold })
  })
  return out.reduce<Segment[]>((acc, s) => {
    const last = acc[acc.length - 1]
    if (last && last.bold === s.bold) last.text += s.text
    else acc.push({ ...s })
    return acc
  }, [])
}

/** A snapshot's lines as blocks: `- ` and `* ` lines are items, other non-empty lines are lines. Headings lose their `#`s. */
export function snapshotBlocks(text: string): Block[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const item = /^[-*]\s+/.test(l)
      const body = item ? l.replace(/^[-*]\s+/, '') : l.replace(/^#{1,6}\s+/, '')
      return { kind: item ? 'item' : 'line', segments: segments(body) }
    })
}

/** The folded card's fields when the repo's `.planner.json` names none (the Worker's DEFAULT_CONFIG.brief). */
export const BRIEF_DEFAULT: readonly string[] = ['Next']

/** A labelled snapshot field: an item opening with a bold `Label:`, e.g. `- **Next:** G4`. */
export interface Field { label: string; segments: Segment[] }

/** The labelled fields of a snapshot's blocks, in order. Unlabelled blocks are skipped. */
export function snapshotFields(blocks: Block[]): Field[] {
  const out: Field[] = []
  for (const b of blocks) {
    const [head, ...rest] = b.segments
    if (b.kind !== 'item' || !head?.bold) continue
    // `**Next:** x` and `**Next**: x` both label a field.
    const inside = head.text.trimEnd().endsWith(':')
    const outside = !inside && rest[0] !== undefined && rest[0].text.startsWith(':')
    if (!inside && !outside) continue
    const label = (inside ? head.text.trimEnd().slice(0, -1) : head.text).trim()
    if (!label) continue
    const body = rest
      .map((s, i) => (i === 0 ? { ...s, text: (outside ? s.text.slice(1) : s.text).trimStart() } : s))
      .filter((s) => s.text.length > 0)
    out.push({ label, segments: body })
  }
  return out
}

/**
 * What the folded card shows: the fields `brief` names (case-insensitive, in `brief`'s order). None found: the first block
 * of the snapshot, so a STATE without labelled fields still shows one line, never a blank card.
 */
export function briefBlocks(blocks: Block[], brief: readonly string[]): { fields: Field[]; missing: string[] } {
  const fields = snapshotFields(blocks)
  const picked: Field[] = []
  const missing: string[] = []
  for (const want of brief) {
    const f = fields.find((x) => x.label.toLowerCase() === want.toLowerCase())
    if (f) picked.push(f)
    else missing.push(want)
  }
  if (picked.length === 0 && blocks[0]) picked.push({ label: '', segments: blocks[0].segments })
  return { fields: picked, missing }
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ageText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

/** A GitHub link the card may open: https://github.com only. */
export const githubLink = (url: string): string | null => (url.startsWith('https://github.com/') ? url : null)
