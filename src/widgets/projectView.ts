// How a project card shows GitHub text (docs/GITHUB-BRIDGE.md §6). Environment-free. GitHub content is data, never markup:
// a STATE snapshot becomes plain blocks of text segments, with bold kept and links reduced to their text. Nothing here
// produces HTML, so nothing a repo writes can run in the app.

export interface Segment { text: string; bold: boolean }
export interface Block { kind: 'item' | 'line'; segments: Segment[] }

/** `[text](url)` → `text`; inline code ticks dropped. */
const plain = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1')

/** One line's segments: `**bold**` pairs become bold segments; an unpaired `**` stays as text. */
export function segments(line: string): Segment[] {
  const out: Segment[] = []
  const parts = plain(line).split('**')
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
