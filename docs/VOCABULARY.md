# Vocabulary

**Binding.** One word per concept, used identically in UI copy, TypeScript names, Dexie tables, snapshot keys, tool
names and docs. A new concept gets a row here before it gets code. Renaming a term is a decision-log entry in
[PROJECT.md](PROJECT.md).

Status column: **shipped** (in schema today) · **H<n>** (tier that introduces it) · **frozen** (kept, no new work).

## Core terms

| Term | Code name | Meaning | Not the same as | Status |
|---|---|---|---|---|
| **Entry** | `Entry`, table `entries` | One captured note, written by the owner: free text, capture time, optional event time. The AI never edits its body | Report | H1 |
| **Inbox** | view, `categoryId === null` | Entries not yet given a category. Capture never blocks on organising | a separate table | H1 |
| **Category** | `Category`, `categoryId` | What a record *is*. Exactly one per record, user-extensible, refused delete while in use | Tag | shipped |
| **Category rule** | `Category.rule` | Standing guidance on how to *read* entries of one category wherever they appear | Lens instruction | H1 |
| **Theme** | `Theme`, `themeMembers` | What a record *contributes to*. Many per record, has its own status and target date | Category | shipped (no UI until H4) |
| **Tag** | `tags: string[]` | Free keyword, many per record, no rules | — | shipped field, UI in H1 |
| **Slice** | `Slice` | A saved filter over entries (categories, themes, tags, time window, inclusion flags). Pure code, no model | Lens | H2 |
| **Lens** | `Lens`, table `lenses` | A saved instruction that processes one slice and produces a report in a declared shape | an app feature; a Slice | H2 |
| **Run** | `Run` (inside Report) | One execution of a lens: slice resolved, prompt composed, model called | — | H2 |
| **Report** | `Report`, table `reports` | Stored output of a run, citing the entries it used. Immutable | Entry | H2 |
| **Composer** | `composeRun()` | The one function that turns lens + entries + category rules into a prompt | — | H2 |
| **Executor** | `executor` field | What performs a run: `claude-code` (outside, over MCP) or `app` (inside) | — | H2 / H5 |
| **Proposal** | `Proposal`, table `proposals` | A change the AI suggests (task, tag, category, rule, theme). Pending until the owner accepts or rejects | a write | H3 |
| **Curation session** | `source.sessionId` | Time the owner spends in chat with the AI organising. Its only outputs are proposals | a run | H3 |
| **Task** | `Task`, table `tasks` | A tracked item with status `open · doing · done · dropped`; may carry `direction: promise · waiting` | Entry; the frozen Commitment | H4 |
| **Origin** | `origin` | Provenance on every record: `author` · `ai-observation` · `proposed` | — | H1 onward |
| **Audit entry** | `AuditEntry` | One logged tool call or model call: caller, arguments, what it read, what it caused | git history (which also exists) | H3 |
| **Account** | `users` (backend) | One person's identity on the backend, created on first sign-in with a valid invite. Every backend row belongs to exactly one account | a device | H1 |
| **Invite** | `invites` | Single-use, expiring code bound to an email; the only way to create an account | — | H1 |
| **Backend** | `api/` | The hosted Cloudflare Worker + D1 that authenticates, cleans, stores and serves records | the private data repo (frozen domain + nightly export) | H1 |
| **Outbox** | table `outbox` | On-device queue of changes not yet acknowledged by the backend. "Unsynced" means the outbox is not empty | the old in-memory `dirty` flag | H1 |
| **Server version** | `serverVersion`, `server_version` | Per-account counter the backend stamps on every write; orders changes and decides conflicts | `updatedAt` (device clock, display only) | H1 |
| **Cursor** | `syncMeta.cursor` | Highest server version a device has pulled; the next pull asks for changes after it | — | H1 |
| **Revision** | `entry_revisions` | An entry body replaced by a later edit, kept by the backend so no text is lost | an Entry | H1 |

## Rules of use

- **Rules mean, lenses do.** A category rule says what entries *mean*; a lens instruction says what *task* to do. On
  apparent conflict, the lens wins on the task and the rule wins on interpretation (H2-LENSES §Composition).
- **AI text never becomes an Entry.** Model output lives in Reports and Proposals. An entry dictated in chat is the
  owner's text, written through `add_entry` with `origin: 'author'` and logged.
- **"Note"** is fine in UI copy as a friendly word for Entry. It is never a type, table or tool name.
- **"Label"** is not used: say Category or Tag. (Shipped code uses `label` as the *display-name field* of Category and
  Theme; that field name stays.)

## Words deliberately not used

| Word | Use instead | Why |
|---|---|---|
| Feature | **Lens** | Collides with product features in every requirements sentence, and with the model gate's internal feature id (H5) |
| Commitment (for open loops) | **Task** with `direction: 'promise'` | `Commitment` is the frozen financial record. A lens may still *title* its report "Today's commitments"; that is report text |
| Activity | **Task** with `completedAt`, `repeatEveryDays` | The 2026-06 Activity-log design folded into Task |
| Label | Category or Tag | Ambiguous between the two |
| Routine, Recipe | **Lens** | Alternatives considered for "feature"; Routine implies a schedule. Lens confirmed by the owner 2026-10-09 |

## Frozen domain (kept, no new work)

| Term | Meaning |
|---|---|
| Commitment | Recurring fixed financial obligation (mortgage, loan, subscription) |
| Payment | Logged payment against a commitment |
| Intention | Mid-horizon plan item with lifecycle status |
| Market entry | Price / availability observation for an intention |
| Snapshot-on-demand | Manual full-state push / pull between Dexie and the data repo. After H1 it carries only the frozen tables; entries sync through the Backend |
