// The Entry record (H1-ENTRIES.md §5.1, VOCABULARY.md). Environment-free: imported by the app and by the Worker.

export interface Entry {
  id: string // uuid v4, generated on the device — the idempotency key
  body: string // owner text, plain text; never rewritten beyond cleaning (§7)
  createdAt: string // ISO datetime, device clock = capture time
  occurredAt: string | null // YYYY-MM-DD when the event date differs from capture
  categoryId: string | null // null = Inbox (UI in H1b)
  tags: string[]
  origin: 'author'
  updatedAt: string // device clock, display only — never decides a conflict
  deletedAt: string | null // soft delete
  serverVersion: number | null // null until the backend has acknowledged it
}

/** What a device may send for an entry: everything except what the server stamps. */
export type EntryInput = Omit<Entry, 'serverVersion'>

export const BODY_MAX_CHARS = 20_000
export const TAGS_MAX = 20
export const TAG_MAX_CHARS = 40
