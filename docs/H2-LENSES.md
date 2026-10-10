# H2 — Lenses (Design)

**Status: S0 draft, 2026-10-08. Open questions unresolved — no S1 code until §8 is closed. Starts after H1 exits.**
Terms per [VOCABULARY.md](VOCABULARY.md); invariants per [ARCHITECTURE.md](ARCHITECTURE.md) (A2, A3 are this tier's).

## 1. Goal

The owner saves instructions ("lenses") that read a slice of entries and report back in a declared shape. Lens value is
tested **before** any lens UI is built: Claude Code runs lenses read-only over the nightly entries export (H1 §9) for two weeks, and
only lenses the owner keeps shape the records and screens.

**Acceptance.** After the trial the owner keeps at least one lens. `composeRun()` reproduces the trial prompts from
typed records. A lens run from the app's lens screen (executor `claude-code` via H3, or a copy-prompt fallback) stores a
report that cites only entries in its slice.

## 2. Slices

```ts
interface Slice {
  categoryIds?: string[]                        // OR within the list; null category = Inbox via includeInbox
  themeIds?: string[]                           // usable once H4 ships theme membership for entries
  tags?: { any?: string[]; all?: string[]; none?: string[] }
  window?: 'today' | 'yesterday' | 'last-7d' | 'last-30d' | { from: string; to: string }
  windowField?: 'occurredAt-or-createdAt' | 'createdAt'   // default: event date when set, else capture date
  includeInbox?: boolean
  limit?: number                                // newest first; guards prompt size
}
```

`resolveSlice(slice, data, now, timeZone) → Entry[]` lives in `src/domain/slice.ts`, takes `now` and `timeZone` as
arguments (no clock reads), and orders by event date then id, so the same inputs give the same ids (A3).

## 3. Records — draft

```ts
interface Lens {
  id: string; name: string; description: string
  slice: Slice
  instruction: string                                   // the task
  output: { shape: 'markdown' | 'checklist' | 'table'; template?: string }
  mayPropose: Array<'task' | 'tag' | 'category' | 'rule' | 'theme'>   // [] = report only; proposals need H3
  trigger: 'manual' | { cron: string }                  // cron runs need H5
  builtIn: boolean; customized: boolean; version: number
  createdAt: string; updatedAt: string
}

interface Report {
  id: string; lensId: string; lensVersion: number
  ranAt: string; executor: 'claude-code' | 'app'
  entryIds: string[]                                     // slice as resolved at run time
  rulesApplied: string[]                                 // category ids whose rule entered the prompt
  body: string                                           // in the lens's output shape
  citations: Array<{ entryId: string; quote: string }>  // quote survives entry deletion (H1 Q5)
  proposalIds: string[]                                  // H3
  origin: 'ai-observation'
}
```

## 4. Composition

`composeRun(lens, entries, categories, settings) → { prompt, header }` in `src/domain/compose.ts` is the only place a
prompt is assembled (A2). Order:

1. **Category rules** of every category present in the slice: what entries *mean*.
2. **Lens instruction**: the *task*.
3. **Output shape / template**, the allowed proposal kinds, and the citation format (cite by entry id).
4. **Entries**, each with id, category label, tags, event date, body.
5. **Language** from settings, never from the template.

Rules mean, lenses do: on apparent conflict the lens wins on the task, the rule on interpretation. The header records
`lensVersion`, `entryIds`, `rulesApplied`, so a report can always be explained.

**Built-ins** are never overwritten: editing one makes a `customized` copy with a reset action.

## 5. Output validation (before a report is stored)

- Every citation's `entryId` is in `entryIds`; otherwise the citation is dropped and the report flagged.
- Proposals of kinds not in `mayPropose` are discarded and counted in the report footer.
- Empty slice → no model call; the report says "no entries matched" (cheap, and a known positive for the slice code).

## 6. Built-in lens candidates (the trial decides which ship)

| Lens | Slice | Instruction (gist) | Shape |
|---|---|---|---|
| Today's commitments | Work, `today` + `yesterday` | What I committed to that is due or overdue; group by person; flag undated | checklist |
| Weekly review | all categories, `last-7d` | What happened, what's open, what repeated | markdown |
| Inbox digest | Inbox only | Suggest a category and tags per entry (report only until H3 proposals) | table |

## 7. Slices of work

| Slice | Content |
|---|---|
| S0 | This doc; questions closed |
| S1 **Trial** | Lens definitions as files, run by Claude Code read-only against the nightly entries export in the private data repo; reports kept beside it; two weeks of real use; trial log of what was kept, changed, dropped |
| S2 | `src/domain/` with `resolveSlice` + `composeRun` + validation, unit-tested against trial prompts (fixtures are synthetic, never real entries) |
| S3 | Backend D1 tables + Dexie version: `lenses`, `reports` (synced through the H1 protocol) |
| S4 | Lens editor with slice preview; report history per lens; copy-prompt fallback executor until H3 |

## 8. Open questions

| # | Question | Default |
|---|---|---|
| Q1 | Where trial lens files and trial reports live | **Lens files and reports in the private data repo under `trial/`, next to the nightly export (Recommended)**: private, versioned. Trial reports are files written by the agent, which the provenance invariant forbids for records; acceptable because they are not records and are discarded or imported at S3 |
| Q2 | Window semantics: which date, which time zone | **Event date when set, else capture date; device time zone stored in settings (Recommended)** |
| Q3 | ~~Report storage vs the 1 MB read ceiling~~ | **Resolved 2026-10-09:** reports are backend D1 rows; the `data.json` ceiling no longer applies to them. Open part: whether old reports join entry eviction once it exists (deferred, H1 §9) |
| Q4 | Editing a lens | **`version` +1 on every save of slice/instruction/output (Recommended)**; reports keep the version they ran |
| Q5 | Output shapes in V1 | **markdown · checklist · table (Recommended)** |
| Q6 | Lens name | **Lens — confirmed by the owner 2026-10-09** |
| Q7 | Prompt-size guard | **`limit` on the slice + a hard cap in the composer that truncates oldest first and says so in the header (Recommended)** |
