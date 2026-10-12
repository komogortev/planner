// A report body is untrusted model text (HW-HARNESS §9 point 7): it is never rendered as HTML and never as links. This turns
// the checklist markdown the journal asks for into plain lines the template shows through interpolation (escaped). Link
// syntax keeps its label and loses its target; emphasis markers are removed; anything else stays as written.
export type ReportLine =
  | { kind: 'check'; done: boolean; text: string; depth: number }
  | { kind: 'bullet'; text: string; depth: number }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }

/** `[label](target)` → `label`; `<https://…>` → the bare text; `**`, `__`, `` ` `` removed. */
export function plainInline(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>]*)>/gi, '$1')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

export function reportLines(body: string): ReportLine[] {
  const out: ReportLine[] = []
  for (const raw of body.split('\n')) {
    if (raw.trim() === '') continue
    const depth = Math.min(3, Math.floor((raw.length - raw.trimStart().length) / 2))
    const line = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^[-*+]\s+\[( |x|X)\]\s*(.*)$/.exec(line))) out.push({ kind: 'check', done: m[1] !== ' ', text: plainInline(m[2]!), depth })
    else if ((m = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line))) out.push({ kind: 'bullet', text: plainInline(m[1]!), depth })
    else if ((m = /^#{1,6}\s+(.*)$/.exec(line))) out.push({ kind: 'heading', text: plainInline(m[1]!) })
    else out.push({ kind: 'text', text: plainInline(line) })
  }
  return out
}

/** "5 min ago", "3 h ago", "2 days ago": the Dashboard shows a report with its age (D-36). */
export function ageLabel(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
