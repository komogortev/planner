// What the "moved" screen tells the owner about this device. Read-only: counts rows, writes nothing.
import { db } from '@/db'
import { flushDrafts, hasDraft } from '@/capture/draft'

export type MovedFacts = { notes: number; unsynced: number; draft: boolean }

export async function movedFacts(): Promise<MovedFacts> {
  flushDrafts() // the stored draft is what the owner sees in the box
  return { notes: await db.entries.count(), unsynced: await db.outbox.count(), draft: hasDraft() }
}

/** The sentence that names what is only on this device. Empty when everything has reached the server. */
export function onlyHereWarning(f: MovedFacts): string {
  const parts = [
    f.unsynced > 0 ? `${f.unsynced} ${f.unsynced === 1 ? 'note was' : 'notes were'} never uploaded` : '',
    f.draft ? 'an unsent draft is waiting in the capture box' : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(' and ')} — they exist only on this device. Save a copy before anything else.` : ''
}
