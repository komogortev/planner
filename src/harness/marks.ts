// Per-note marks for the notes list: open questions, open proposals about the note, its state row, how many questions
// were answered. Pure. A note with nothing to show is absent from the map, so its row stays a plain row.
import type { EntryState, Link, Question } from '@/domain/harness'
import type { NoteMarksOf } from '@/notes/NotesList.vue'

type Live = { deletedAt?: string | null }

export function marksByNote(questions: (Question & Live)[], links: (Link & Live)[], states: (EntryState & Live)[]): Map<string, NoteMarksOf> {
  const out = new Map<string, NoteMarksOf>()
  const of = (id: string): NoteMarksOf => {
    let m = out.get(id)
    if (!m) out.set(id, (m = { questions: [], proposals: [], state: null, answered: 0 }))
    return m
  }
  const stateById = new Map(states.filter((s) => !s.deletedAt).map((s) => [s.id, s]))
  for (const s of stateById.values()) if (s.state !== 'open' || s.followUpOn) of(s.id).state = s
  // A done or dropped note is never assessed again, so a question still open on it would go nowhere: it is not asked.
  const isOpen = (entryId: string) => (stateById.get(entryId)?.state ?? 'open') === 'open'
  for (const q of questions) {
    if (q.deletedAt) continue
    if (q.state === 'open') {
      if (isOpen(q.entryId)) of(q.entryId).questions.push(q)
    }
    else if (q.state === 'answered') of(q.entryId).answered++
  }
  // A proposal is asked on the note it would change; once that note is done or dropped there is nothing left to decide.
  for (const l of links) {
    if (l.deletedAt || l.state !== 'proposed') continue
    if (!isOpen(l.toEntryId)) continue
    of(l.toEntryId).proposals.push(l)
  }
  for (const m of out.values()) m.questions.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
  return out
}
