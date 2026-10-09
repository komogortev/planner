# Architecture

**Binding** for H-tier work. Terms per [VOCABULARY.md](VOCABULARY.md). What exists today is marked *shipped*; the rest
is the target the H-tiers build toward. Changing a section here is a decision-log entry in [PROJECT.md](PROJECT.md).

## 1. Layers

```
CAPTURE                ORGANISE                          PROCESS
Entry ─────────────▶   Category · Theme · Tag ───────▶   Slice ─▶ Lens (+ Category rules) ─▶ Run ─▶ Report
(owner writes)         (owner; or AI via Proposal)       (pure)   (saved instruction)        (model)  └▶ Proposals ─▶ owner accepts
```

- **Capture** never blocks on organising. An entry with no category is in the Inbox.
- **Organise** is owner-only. The AI organises by proposing.
- **Process** is the only layer that calls a model, and only inside a Run. Slices are deterministic.

## 2. Invariants — each enforced in exactly one place

| # | Invariant | Choke point | Tier |
|---|---|---|---|
| A1 | **Provenance.** Every record carries `origin`. AI text never lands in an entry body. Nothing the AI produces changes a record until the owner accepts the proposal | the write path of each store; `proposals` accept action | H1 field, H3 enforcement |
| A2 | **One composer.** A prompt is assembled only by `composeRun()`; both executors call it | `src/domain/compose.ts` | H2 |
| A3 | **Deterministic slices.** Same slice + same data → same entries; a report stores the entry ids it saw | `src/domain/slice.ts` | H2 |
| A4 | **One tool registry, many transports.** The same handlers serve the MCP server and, later, the in-app chat | `tools/registry` | H3 |
| A5 | **Audit.** Every tool call and every model call is listed with what it read and what it caused | audit log (+ git history of the data repo) | H3 |
| A6 | **No destructive tool.** No delete, no bulk overwrite, no accepting own proposals, nothing that sends | the registry: such tools are never registered | H3 |
| A7 | **One model gate.** Every in-app model call goes through `callAI(featureId, …)`; model and effort resolve from settings | `callAI` | H5 |
| A8 | **One scheduler, one notifier.** Background runs are registry entries with a global pause; notifications are capped per day and silent by default | `SCHEDULES`, `sendNotification` | H5 |
| A9 | **Frozen schema versions.** One per-row migration function serves Dexie upgrade and snapshot restore | `src/db/migrations.ts` | shipped |

## 3. Module boundaries

Today (*shipped*): `src/db/` (Dexie, schema, migrations, snapshot, GitHub client, sync tracking) · `src/stores/` (Pinia,
`useLiveQuery`) · `src/views/` · `src/components/` · `src/composables/`.

Target:

| Module | Contents | May import | Must not import |
|---|---|---|---|
| `src/domain/` (H2) | Record types re-exported from schema, `resolveSlice()`, `composeRun()`, report/citation validation | nothing but TS | Dexie, Vue, Pinia, DOM, `fetch` |
| `src/db/` | Dexie tables, migrations, snapshot build/parse, GitHub client | `domain` | Vue |
| `src/stores/` | Pinia stores, the only writers of Dexie from the UI | `db`, `domain` | — |
| `src/views/`, `src/components/` | UI | `stores`, `domain` | `db` directly (except existing L1 settings code) |
| `mcp/` (H3, Node) | Local MCP server: tool registry, git-backed snapshot read/write, audit | `domain`, snapshot parse/build | Dexie, Vue |

The `domain` purity rule is what lets the browser app and the Node MCP server run identical slice and composer code
(A2, A3). Placement of `mcp/` (same repo vs separate) is decided in H3-S0; the default is same repo, separate
`package.json`.

## 4. Storage and sync

- **On device:** Dexie (IndexedDB). Current schema **v3**; H1 introduces **v4** (`entries` + `Category.rule`), H2 **v5**
  (`lenses`, `reports`), H3 **v6** (`proposals`, `audit`), H4 **v7** (`tasks`). One version per tier, never edited once
  shipped. *Version numbers are planned, not reserved: a tier that needs no schema change skips one.*
- **Remote:** single `data.json` in the owner's private data repo, `schemaVersion` today **2**, bumped with each Dexie
  version that changes the snapshot shape. sha token = optimistic concurrency; 409 opens the conflict modal (*shipped*).
- **Agent writes (H3):** the MCP server reads `data.json` from a local clone, applies one tool's write, bumps
  nothing but the arrays it touched, commits with a message naming the tool, and pushes. The app sees it as a remote
  change through the shipped conflict/restore flow. One commit per write; whole-file merges are acceptable for one user.
- **Growth — hard ceiling at 1 MB with the shipped client.** `getDataJson` uses the Contents API JSON wrapper, which
  returns file content only up to 1 MB; above that `content` comes back empty and Restore fails. `data.json` is
  8.4 KB today (2026-10-08). Entries alone stay far under the ceiling for years; **reports are AI prose and will not**
  (a daily lens at a few KB per report is 1–2 MB a year). Decided in H2-S0 (H2-LENSES Q3): reports in their own file,
  or the client moves to the raw media type / Git blobs API before reports ship.

## 5. AI execution modes

| Mode | Who runs the model | Cost | Used for | Tier |
|---|---|---|---|---|
| **Outside** | Claude Code, reaching the data through the local MCP server | existing Claude subscription | curation sessions, on-demand lens runs | H2 trial (read-only), H3 |
| **Inside** | the app, through `callAI` | API key, billed per token | runs with no session open: scheduled lenses, notifications | H5 |

Environment facts that bound these choices:

- The Claude subscription that powers Claude Code does not extend to an app's own model calls; inside mode needs a
  separate API key and its spend.
- Claude's phone and web apps can reach only **remote** MCP servers. The H3 server is local, so chat works from the
  desktop only. Phone chat needs a hosted endpoint or in-app chat; both are owner decisions, not defaults.
- Phone **capture** depends on neither: it is the PWA.

## 6. Run lifecycle

1. Resolve the lens's slice against current data → ordered entry ids (A3).
2. Collect the category rules of every category present in the resolved entries.
3. `composeRun(lens, entries, rules)` → prompt text + run header (lens id/version, entry ids, rules applied) (A2).
4. Executor calls the model.
5. Validate the output: every citation names an entry in the slice; proposals only of kinds the lens allows.
6. Store the Report (immutable) and its Proposals (pending). Log the run (A5).

Steps 1–3 and 5 are `domain` code; only step 4 differs between executors.

## 7. Security and privacy

- Code repo public; data repo private (Connect refuses a public data repo — *shipped*).
- PAT in IndexedDB on the device, never logged, never sent outside `api.github.com` (*shipped*). The H3 server uses the
  owner's local git credentials, not the app's PAT.
- A run sends only the slice's entries and the involved category rules to the model provider.
- No real entries in fixtures, tests or docs in this repo.
