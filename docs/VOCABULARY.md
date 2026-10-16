# Vocabulary

**Binding.** One word per concept, used identically in UI copy, TypeScript names, Dexie tables, snapshot keys, tool
names and docs. A new concept gets a row here before it gets code. Renaming a term is a decision-log entry in
[PROJECT.md](PROJECT.md).

Status column: **shipped** (in schema today) · **H<n>** (tier that introduces it) · **frozen** (kept, no new work) · **parked** (depends on H1b, which is conditional since 2026-10-10: built only if the lens trial shows the AI needs categories or tags; no code until then).

## Core terms

| Term | Code name | Meaning | Not the same as | Status |
|---|---|---|---|---|
| **Entry** | `Entry`, table `entries` | One captured note, written by the owner: free text, capture time, optional event time. The AI never edits its body | Report | H1 |
| **Inbox** | view, `categoryId === null` | Entries not yet given a category. Capture never blocks on organising | a separate table | H1b, parked |
| **Category** | `Category`, `categoryId` | What a record *is*. Exactly one per record, user-extensible, refused delete while in use | Tag | shipped |
| **Category rule** | `Category.rule` | Standing guidance on how to *read* entries of one category wherever they appear | Lens instruction | H1b, parked |
| **Theme** | `Theme`, `themeMembers` | What a record *contributes to*. Many per record, has its own status and target date | Category | shipped (no UI); UI parked |
| **Tag** | `tags: string[]` | Free keyword, many per record, no rules | — | shipped field; UI parked; usable in a slice (D-33) |
| **Slice** | `Slice` | A saved filter over entries (categories, themes, tags, time window, inclusion flags). Pure code, no model | Lens | H2 |
| **Lens** | `Lens`, table `lenses` | A saved instruction that processes one slice and produces a report in a declared shape | an app feature; a Slice; a Widget | H2 |
| **Run** | `Run` (inside Report) | One execution of a lens: slice resolved, prompt composed, model called | — | H2 |
| **Report** | `Report`, table `reports` | Stored output of a run, citing the entries it used. Immutable | Entry | H2 |
| **Composer** | `composeRun()` | The one function that turns lens + entries + category rules into a prompt | — | H2 |
| **Executor** | `executor` field | What performs a run: `copy-prompt` (shipped; shown as *manual*), `model` (the user's registered model via the Worker, H5) or `claude-code` (outside, over MCP, H3, optional) | — | shipped / H5 |
| **Routine** | `Routine`, table `routines` | A declared run (the harness, a widget's run, a lens) bound to a time, run by the Worker with the app closed through the user's registered model (D-89) | Lens (what is run); Run (one execution) | H5 S3 |
| **Project** | widget `kind: 'project'`, field `project: { repo, private }` | A GitHub repo the user switched on, shown on the Dashboard as a card with its STATE snapshot and recent merges. How the card looks is the repo's own `.planner.json`. Switched off, never deleted | Theme (parked); Category; the planner's own PROJECT.md | G2 (D-121) |
| **Integration** | D1 table `integrations`, `IntegrationsCard` | An outside account the user connected by pasting a token, held encrypted on the Worker and never returned (GitHub first: login, last 4 characters, expiry) | Model (also a pasted key, but for model calls) | G1 (D-121) |
| **Model** | `ModelConfig`, D1 table `models` | A model the user registered: label, request format, endpoint, the provider's model id; the key is held encrypted on the Worker and never returned (D-79) | a provider account or subscription | H5 |
| **Proposal** | `Proposal`, table `proposals` | A change the AI suggests (task, tag; category, rule and theme kinds parked). Accepted inline in the report in the widget, no queue page until volume demands one (D-38). Pending until the owner accepts or rejects | a write | H3 |
| **Curation session** | `source.sessionId` | Time the owner spends in chat with the AI organising. Its only outputs are proposals | a run | parked |
| **Task** | `Task`, table `tasks` | A topic the owner acts on, derived by the harness from one or more notes (`sourceEntryIds`) or added by the owner. State `open · done · dropped`, optional `due` and carry (`followUpOn`); `by` says who wrote its text last, and the model never overwrites owner text (D-69 supersedes D-39) | Entry; the frozen Commitment | HW (domain built, S3 v2 S1) |
| **Task proposal** | `TaskProposal`, table `taskProposals` | A harness suggestion about existing Tasks — `close · revise · split · merge` — applied only by the owner's confirmation; proposed once (D-74) | Link (notes); Proposal (H3) | HW (domain built) |
| **Today** (was Daily, D-108) | `dailyTasks()`, widget `system-today` | The open Tasks whose day (carry, else due, else creation day) has come, done ones sunk to the bottom; computed on the device. A system widget, on by default | the Summary widget | HW (shipped; renamed in the UI 2026-10-13, code names unchanged) |
| **Removal question** | `Question.kind = 'removal'` | The question the app writes when a line is removed from Daily's summary: drop it, or keep it for later (D-73, D-76) | a harness question | HW (domain built) |
| **Origin** | `origin` | Provenance on every record: `author` · `ai-observation` · `proposed` | — | H1 onward |
| **Audit entry** | `AuditEntry` | One logged tool call or model call: caller, arguments, what it read, what it caused | git history (which also exists) | H3 |
| **Account** | `users` (backend) | One person's identity on the backend, created on first sign-in with a valid invite. Every backend row belongs to exactly one account | a device | H1 |
| **Invite** | `invites` | Single-use, expiring code bound to an email; the only way to create an account | — | H1 |
| **Backend** | `api/` | The hosted Cloudflare Worker + D1 that authenticates, cleans, stores and serves records | the private data repo (frozen domain + nightly export) | H1 |
| **Outbox** | table `outbox` | On-device queue of changes not yet acknowledged by the backend. "Unsynced" means the outbox is not empty | the old in-memory `dirty` flag | H1 |
| **Server version** | `serverVersion`, `server_version` | Per-account counter the backend stamps on every write; orders changes and decides conflicts | `updatedAt` (device clock, display only) | H1 |
| **Cursor** | `syncMeta.cursor` | Highest server version a device has pulled; the next pull asks for changes after it | — | H1 |
| **Revision** | `entry_revisions` | An entry body replaced by a later edit, kept by the backend so no text is lost | an Entry | H1 |
| **Widget** | `WidgetRecord`, table `widgets`, record kind `widget` | A surface on the Dashboard. One instance per widget, per account; activation (`active`) is a field on the widget's own row, synced, so every device shows the same Dashboard. A system widget with no row is at its default (a device never writes a row only to state a default). A different use is a **clone** (D-111) | Lens; Entry | HW (system widgets shipped 2026-10-13; custom widgets next) |
| **System widget** | `kind: 'system'`, `SYSTEM_WIDGETS` (`src/widgets/system.ts`) | A built-in view that holds no lens, under a fixed id: **Today** (`system-today`, on), **Summary** (`system-summary`, a written summary of today's notes; D-109), **Notes** (`system-notes`, the source archive; D-110). Summary and Notes are off and marked *suggested* | Prompt widget | HW (shipped 2026-10-13) |
| **Prompt widget** | `Widget.kind = 'prompt'` | A widget that holds a Lens and shows its last report (cached per widget on the device and the server) with its age and a Run button | System widget | HW |
| **Dashboard** | page 2 | The home of the active widgets, in `SYSTEM_WIDGETS` order; the questions strip docks at its bottom and is not a widget. None active: a line pointing to the Widgets page | Widgets page | shipped |
| **Widgets page** | page 3 (between Dashboard and Settings) | Lists every widget with a switch (on the Dashboard or not); CreateWidget stays inert until custom widgets | Dashboard | shipped 2026-10-13 |
| **Hook** | not a stored type | An actionable item (promise, wait, date) the model finds in the note's context at run time. Nothing is extracted at capture and no index is stored (D-34) | Task | H2 / H4 |
| **Harness** | `HARNESS_VERSION`, `composeHarness()` | The app-owned stage-1 prompt that reads new and still-open notes, links them, and asks short questions. v1 marks notes. v2 (`composeHarness2()`) also creates and attaches Tasks and proposes the rest (D-69, D-74). It never writes Entry text or owner Task text. Owner-editable never in H-S1 (HW-HARNESS.md) | Lens; Widget | HW |
| **Journal** (D-107, D-108) | the harness loop: `composeHarness2()` + the questions strip | The core: AI processing of every input (notes and actions), classifying into Tasks and asking clarifying **Questions**. Widgets only show its output. The UI does not name it yet (the strip says Questions · Get feedback) | the Summary widget (formerly the card titled Journal) | HW |
| **Assessment** | `Assessment`, table `assessments` | A record that one run assessed one note at a harness version. "Processed" = a row at the current version with no newer answer | a Report | HW |
| **Question** | `Question`, table `questions` | A short question the harness attached to a note or (v2) to a Task — exactly one (D-74) — with the owner's answer stored on the same row. Open · answered · dismissed; never repeated once answered or dismissed | an Entry (the answer is the owner's text but is not one) | HW |
| **Link** | `Link`, table `links` | A harness *proposal* that one note concludes (`closes`) or should be picked up on a date (`carries`) another. Proposed until the owner confirms or rejects; a pair is proposed once | Task; Proposal (H3) | HW |
| **Entry state** | `EntryState`, table `entryStates` | Per-note `open · done · dropped` plus an optional follow-up date; a note with no row is open. Set by the owner, or by the owner confirming a link | a field on Entry | HW |

## Rules of use

- **Rules mean, lenses do.** A category rule says what entries *mean*; a lens instruction says what *task* to do. On
  apparent conflict, the lens wins on the task and the rule wins on interpretation (H2-LENSES §Composition).
- **AI text never becomes an Entry.** Model output lives in Reports and Proposals. An entry dictated in chat is the
  owner's text, written through `add_entry` with `origin: 'author'` and logged.
- **Capture is typeless** (D-07): an Entry carries text and its automatic capture time; intent is found later from context, never chosen at capture. Manual sorting stays an option, not the default.
- **A Lens is the instruction; a Widget is the surface.** A clone of a prompt widget copies its lens and records the lineage; a report records the lens version that produced it (D-32).
- **"Note"** is fine in UI copy as a friendly word for Entry. It is never a type, table or tool name.
- **"Label"** is not used: say Category or Tag. (Shipped code uses `label` as the *display-name field* of Category and
  Theme; that field name stays.)

## Words deliberately not used

| Word | Use instead | Why |
|---|---|---|
| Feature | **Lens** | Collides with product features in every requirements sentence, and with the model gate's internal feature id (H5) |
| Commitment (for open loops) | **Task** with `direction: 'promise'` | `Commitment` named the deleted financial record (D-112). A lens may still *title* its report "Today's commitments"; that is report text |
| Activity | **Task** with `completedAt`, `repeatEveryDays` | The 2026-06 Activity-log design folded into Task |
| Label | Category or Tag | Ambiguous between the two |
| Recipe | **Lens** | Alternative considered for "feature". Lens confirmed by the owner 2026-10-09. (*Routine* was rejected here too because it implies a schedule; since D-89 it names exactly that) |

## Deleted domain (2026-10-13, D-112: the names are free for reuse only with a new definition)

| Term | Meaning |
|---|---|
| Commitment | Recurring fixed financial obligation (mortgage, loan, subscription) |
| Payment | Logged payment against a commitment |
| Intention | Mid-horizon plan item with lifecycle status |
| Market entry | Price / availability observation for an intention |
| Snapshot-on-demand | Manual full-state push / pull between Dexie and the data repo, removed with the domain |
