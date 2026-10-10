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
| A5 | **Audit.** Every tool call and every model call is listed with what it read and what it caused | audit table in D1 | H3 |
| A6 | **No destructive tool.** No delete, no bulk overwrite, no accepting own proposals, nothing that sends | the registry: such tools are never registered | H3 |
| A7 | **One model gate.** Every in-app model call goes through `callAI(featureId, …)`; model and effort resolve from settings | `callAI` | H5 |
| A8 | **One scheduler, one notifier.** Background runs are registry entries with a global pause; notifications are capped per day and silent by default | `SCHEDULES`, `sendNotification` | H5 |
| A9 | **Frozen schema versions.** One per-row migration function serves Dexie upgrade and snapshot restore | `src/db/migrations.ts` | shipped |
| A10 | **Capture is atomic and never waits on the network.** An entry and its outbox row commit in one Dexie transaction | `src/stores/entries.ts` write path | H1 |
| A11 | **Tenant isolation.** The backend takes `user_id` from the session only, never from a request body; every query passes through one data-access helper that requires it | `api/src/db/` helper | H1 |
| A12 | **The server orders changes.** A per-user `server_version` decides conflicts; device clocks never do; a replaced body is kept, not lost | `/sync/push` | H1 |

## 3. Module boundaries

Today (*shipped*): `src/db/` (Dexie, schema, migrations, snapshot, GitHub client, sync tracking) · `src/stores/` (Pinia,
`useLiveQuery`) · `src/views/` · `src/components/` · `src/composables/`.

Target:

| Module | Contents | May import | Must not import |
|---|---|---|---|
| `src/domain/` (H1) | Record types, cleaning/validation rules (H1); `resolveSlice()`, `composeRun()`, report/citation validation (H2) | nothing but TS | Dexie, Vue, Pinia, DOM, `fetch` |
| `src/db/` | Dexie tables, migrations; snapshot build/parse + GitHub client (frozen financial domain only after H1) | `domain` | Vue |
| `src/auth/` (H1) | Session token, sign-in flow, token renewal | `db` | — |
| `src/sync/` (H1) | Outbox flush, pull since cursor, backoff, storage budget, `persist()` | `db`, `domain`, `auth` | Vue |
| `src/stores/` | Pinia stores, the only writers of Dexie from the UI | `db`, `domain`, `sync` | — |
| `src/views/`, `src/components/` | UI | `stores`, `domain` | `db` directly (except existing L1 settings code) |
| `api/` (H1, Cloudflare Worker) | Auth, invites, `/sync/push`, `/sync/pull`, `/entries`, cleaning, D1 schema and migrations; H3 adds the tool registry and a remote MCP endpoint | `domain` | Dexie, Vue |

The `domain` purity rule is what lets the browser app and the Worker run identical cleaning, slice and composer code
(A2, A3). `api/` lives in this repo with its own `package.json`; secrets live in Worker environment variables, never
in the repo.

## 4. Storage and sync

Changed 2026-10-09 (owner): entries live on a hosted backend, not in `data.json`. Detail: [H1-ENTRIES.md](H1-ENTRIES.md) §5–§6.

- **On device:** Dexie (IndexedDB), a cache with a storage budget, not necessarily a full copy. Current schema **v3**;
  H1 introduces **v4** (`entries`, `outbox`, `syncMeta`). Later tiers add their tables in their own version. One
  version per tier, never edited once shipped. *Version numbers are planned, not reserved.*
- **Backend:** Cloudflare Worker + D1 (SQLite). Every row keyed `(user_id, id)`. Per-record sync: the client pushes
  outbox mutations (idempotent by client-generated id) and pulls changes after a per-user `server_version` cursor. Soft
  deletes travel as rows. This replaces whole-snapshot sync for entries, and with it the 409 entry-loss hazard.
- **Frozen financial domain:** stays on the shipped L1 path — single `data.json` in the owner's private data repo,
  sha concurrency, conflict modal, 1 MB read ceiling (irrelevant at its frozen size).
- **Owner-held copy:** a nightly Worker cron exports the owner's entries to the private data repo; D1 point-in-time
  restore covers the backend itself.
- **Agent writes (H3):** through the backend's tool registry, not git commits — the app receives them as ordinary
  pulled changes. Reports (H2) are D1 rows, so the 1 MB `data.json` ceiling no longer bounds them.

## 5. AI execution modes

| Mode | Who runs the model | Cost | Used for | Tier |
|---|---|---|---|---|
| **Outside** | Claude Code (desktop) or the Claude phone app, reaching the data through the backend's remote MCP endpoint | existing Claude subscription | curation sessions, on-demand lens runs | H2 trial (read-only), H3 |
| **Inside** | the app, through `callAI` | API key, billed per token | runs with no session open: scheduled lenses, notifications | H5 |

Environment facts that bound these choices:

- The Claude subscription that powers Claude Code does not extend to an app's own model calls; inside mode needs a
  separate API key and its spend.
- Claude's phone and web apps can reach only **remote** MCP servers. With the hosted backend (2026-10-09) the H3
  endpoint can be remote, so phone chat no longer needs a separate hosting decision; it needs the MCP OAuth flow in H3.
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

- Code repo public; data repo private (Connect refuses a public data repo — *shipped*). Worker secrets (OAuth client
  secrets, export token) live in Worker environment variables only.
- Accounts are invite-only; sign-in is Google or GitHub OAuth, no passwords stored. The session token travels as
  `Authorization: Bearer` (client and Worker are different sites; Safari blocks cross-site cookies) and is kept in
  IndexedDB. Consequence: injected script is the main threat → entry bodies are plain text, escaped at render, and the
  CSP limits `connect-src` to the Worker and `api.github.com`.
- The backend reads entry content (owner decision B5, no end-to-end encryption); D1 encrypts at rest.
- PAT in IndexedDB on the device, never logged, never sent outside `api.github.com` (*shipped*; frozen domain only
  after H1).
- A run sends only the slice's entries and the involved category rules to the model provider.
- No real entries in fixtures, tests or docs in this repo.
