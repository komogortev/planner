import Dexie, { type Table } from 'dexie'
import type { OutboxRow, SyncMeta } from './schema'
import type { Entry } from '@/domain/entry'
import type { EntryState, Link } from '@/domain/harness'
import type { StoredAssessment, StoredQuestion } from '@/domain/harness2'
import type { Report } from '@/domain/journal'
import type { RunRecord, SyncFields, WidgetRecord } from '@/domain/records'
import type { Task, TaskProposal } from '@/domain/tasks'

/**
 * Personal-planner IndexedDB schema (Dexie).
 *
 * Version 1 — initial schema.
 * Version 2 — added `settings` singleton table for L1 GitHub sync (2026-04-26).
 * Version 3 — L2 organization layer (2026-04-28):
 *               - new tables: `categories`, `themes`, `themeMembers`
 *               - new fields on entity tables: `categoryId`, `tags` (multi-entry index)
 *               - `intentions.category` free-text → `categoryId` foreign key
 *
 * Version 4 — H1 entries: `entries`, `outbox`, `syncMeta` (2026-10-10). Additive; the financial tables are untouched.
 * Version 5 — harness + widget records (HW-HARNESS.md §5, 2026-10-11): seven tables, one per kind. Additive; nothing else changes.
 * Version 6 — S3 v2 Tasks: `tasks`, `taskProposals`, and a `taskId` index on questions and assessments.
 * Version 7 — financial domain deleted (2026-10-13): the tables versions 1–3 created are dropped (their declarations stay).
 *
 * Once shipped, a version is FROZEN. Schema changes go via a NEW version+upgrade.
 */
export class PlannerDb extends Dexie {
  entries!: Table<Entry, string>
  outbox!: Table<OutboxRow, number>
  syncMeta!: Table<SyncMeta, string>
  // Stored v2 shapes (S3 v2 S3): a row is about a note or a Task, and S3a rows lack `taskId`/`kind`. Read through
  // `readQuestion`/`readAssessment`; the S3a screens take only the note rows (`isNoteQuestion`/`isNoteAssessment`).
  assessments!: Table<StoredAssessment & SyncFields, string>
  questions!: Table<StoredQuestion & SyncFields, string>
  links!: Table<Link & SyncFields, string>
  entryStates!: Table<EntryState & SyncFields, string>
  widgets!: Table<WidgetRecord & SyncFields, string>
  reports!: Table<Report & SyncFields, string>
  runs!: Table<RunRecord & SyncFields, string>
  tasks!: Table<Task & SyncFields, string>
  taskProposals!: Table<TaskProposal & SyncFields, string>

  /** `name` is only ever overridden by tests that need a second device. */
  constructor(name = 'personal-planner') {
    super(name)
    this.version(1).stores({
      // Indices — first field is primary key, subsequent are secondary indices
      commitments: 'id, type, startDate, updatedAt',
      payments: 'id, commitmentId, date',
      intentions: 'id, status, category, updatedAt',
      marketEntries: 'id, intentionId, observedAt',
    })

    // v2 — add settings singleton table for L1 GitHub sync.
    // No upgrade callback needed: absence of the row means "not connected".
    // Existing v1 data is untouched.
    this.version(2).stores({
      commitments: 'id, type, startDate, updatedAt',
      payments: 'id, commitmentId, date',
      intentions: 'id, status, category, updatedAt',
      marketEntries: 'id, intentionId, observedAt',
      settings: 'id',
    })

    // v3 — L2 organization layer.
    //   - drops `intentions.category` secondary index (the field is renamed/dropped per row in upgrade)
    //   - adds `categoryId` index on entity tables for "filter by category" list views
    //   - adds `*tags` multi-entry index on entity tables for "filter by tag"
    //   - adds 3 new tables: `categories`, `themes`, `themeMembers`
    this.version(3)
      .stores({
        commitments: 'id, type, startDate, updatedAt, categoryId, *tags',
        payments: 'id, commitmentId, date',
        intentions: 'id, status, updatedAt, categoryId, *tags',
        marketEntries: 'id, intentionId, observedAt, categoryId, *tags',
        settings: 'id',
        categories: 'id, label, sortOrder',
        themes: 'id, label, status, targetDate, updatedAt',
        themeMembers: 'id, themeId, entityId, [themeId+entityType+entityId]',
      })
    // The v3 upgrade (seed categories, migrate intentions) was removed with the financial domain: v7 drops every table it wrote.

    // v4 — H1 entries. New tables only, so no upgrade callback; existing data is untouched.
    this.version(4).stores({
      entries: 'id, createdAt, occurredAt, categoryId, *tags, updatedAt, serverVersion',
      outbox: '++seq, entityId',
      syncMeta: 'userId',
    })

    // v5 — harness + widget records. New tables only, so no upgrade callback; entries, outbox and the financial tables are untouched.
    // `serverVersion` is indexed on each so a sweep can find what the server has not acknowledged.
    this.version(5)
      .stores({
        assessments: 'id, entryId, runId, serverVersion',
        questions: 'id, entryId, state, serverVersion',
        links: 'id, fromEntryId, toEntryId, state, serverVersion',
        entryStates: 'id, state, followUpOn, serverVersion',
        widgets: 'id, kind, active, serverVersion',
        reports: 'id, widgetId, runId, ranAt, serverVersion',
        runs: 'id, stage, ranAt, serverVersion',
      })
      // A build from before v5 asks a newer Worker for changes, ignores the `records` it cannot read, and still moves its cursor
      // past them. Left alone, that device would upgrade with a cursor that is already beyond records it never stored. Pulling
      // again from 0 once is safe (upserts are idempotent; a queued local edit is never overwritten) and costs one fetch.
      .upgrade((tx) => tx.table('syncMeta').toCollection().modify((m: { cursor: number }) => { m.cursor = 0 }))

    // v6 — S3 v2 Tasks (HW-HARNESS §11): two new tables, and a `taskId` index on questions and assessments (a Task's thread).
    // Rows from before carry no `taskId` and are simply not in that index. The cursor goes back to 0 for the same reason as
    // v5, and one more: a v5 build drops the keys it does not know (`taskId`, `kind`) from the rows it pulls, and refuses a
    // row whose `entryId` is null. Pulling again replaces those copies with the full rows.
    this.version(6)
      .stores({
        assessments: 'id, entryId, taskId, runId, serverVersion',
        questions: 'id, entryId, taskId, state, serverVersion',
        tasks: 'id, state, due, followUpOn, serverVersion',
        taskProposals: 'id, state, runId, serverVersion',
      })
      .upgrade((tx) => tx.table('syncMeta').toCollection().modify((m: { cursor: number }) => { m.cursor = 0 }))

    // v7 — the financial domain is deleted (owner, 2026-10-13: outdated, no export kept). Its seven tables and the L1 GitHub
    // settings row (which held a personal access token) are dropped with their data on every device that opens this build.
    this.version(7).stores({
      commitments: null,
      payments: null,
      intentions: null,
      marketEntries: null,
      categories: null,
      themes: null,
      themeMembers: null,
      settings: null,
    })

    // ---------------------------------------------------------------------
    // Migration template — DO NOT REMOVE
    // ---------------------------------------------------------------------
    // Once shipped, a version() block is FROZEN. To change schema (add/remove
    // indices, rename fields, split tables), bump the version and provide a
    // new .upgrade() callback. Dexie applies upgrades in order for users who
    // installed earlier versions.
    //
    // Rules:
    //   - Never edit a shipped version() — only add new versions.
    //   - Test upgrades against a real DB populated at the prior version.
    //   - Tables not listed in a new version() call inherit the prior schema.
    //   - Set a store to `null` to drop it (rare; data loss).
  }
}

export const db = new PlannerDb()
