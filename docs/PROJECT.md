# Personal Planner — PROJECT

Personal planning + tracking PWA. Local-first, offline-capable, installable to phone from GitHub Pages. GitHub Contents API sync (private data repo) enables durable data across app iterations and devices.

## Vision

A single place to track three intertwined domains of personal financial / life planning:

- **Commitments** — fixed obligations (mortgage, loan, subscription) with amortization math and actual payment history
- **Intentions** — mid-horizon wants / plans with explicit lifecycle (`considering → researching → committed → acquired → dropped`)
- **Market entries** — append-only price / availability observations per intention, for trend analysis

Runs offline on a phone. Data belongs to the user; sync is opt-in and user-controlled (their own private GitHub repo).

## Tier structure

### Base — installable, locally persistent

**Goal.** The app installs on a phone from a public GitHub Pages URL, works offline, keeps data between sessions and across app updates.

**Functional scope (DONE at L0 POC, commit `1b53887`)**

- Entity CRUD for commitments, payments, intentions, market entries
- Amortization math with derived principal / interest split; balance-corrected final row; 10/10 unit tests
- Intention lifecycle transitions
- Market sparkline trends
- IndexedDB persistence via Dexie with Pinia reactivity through `useLiveQuery`
- PWA shell (`vite-plugin-pwa`, `autoUpdate` service worker) in dev

**Shipping scope (NOT YET DONE)**

- `vite.config.ts` `base` path set for GH Pages subpath hosting
- Generated PWA icons in `public/`: 192px, 512px, maskable 512px, apple-touch-icon 180px, favicon.ico
- `theme-color` + `apple-mobile-web-app-capable` meta tags in `index.html`
- GitHub Actions workflow: build on push to `main`, deploy `dist/` to `gh-pages` branch
- Public GitHub repo + Pages enabled (source: `gh-pages` branch)
- Verified install flow on Chrome Android ("Add to Home Screen") and iOS Safari ("Add to Home Screen")
- Verified cold-start offline, data survives reload, data survives service-worker update
- **Dexie schema migration discipline** — every schema change must `version(N+1).stores({…}).upgrade(trans => …)`; `version(1)` is frozen once shipped. This is load-bearing for the "no data wipe" promise.

**Acceptance.** User installs on their phone, adds a commitment on Monday, closes the app, reopens Tuesday with no network, and sees the commitment. Deploy a new version that adds a field; reopen on phone and the commitment is still there.

### L1 — Durable sync (GitHub Contents API)

**Goal.** User data survives app iterations (schema changes, deploys, device switches) by snapshotting to the user's own private GitHub repo as a single JSON file. Multi-device usage is supported via "last write wins by id" — whichever device syncs later overrides the previous record on id collision.

**Functional scope**

- Separate **private** data repo (e.g. `komogortev/planner-data`) holding a single canonical file `data.json`
- `data.json` schema: `{ schemaVersion, exportedAt, deviceId, commitments[], payments[], intentions[], market_entries[] }` — entity arrays match Dexie tables 1:1
- Auth: fine-grained Personal Access Token, scoped to single repo, `Contents: read+write`, max 90-day expiry
- PAT stored in IndexedDB (settings table) — survives reload, single-user device assumption
- Settings panel: Connect form (PAT + `owner/repo`), connection test (`GET /user`), connection status display, last-sync timestamp, disconnect
- "Sync now" button: build JSON snapshot from all 4 Dexie tables → `PUT /repos/{owner}/{repo}/contents/data.json` with stored `sha`
- "Restore from GitHub" button: `GET /repos/{owner}/{repo}/contents/data.json` → confirmation prompt → Dexie transaction that clears all 4 tables and `bulkAdd`s incoming rows → store new `sha` + `lastSyncedAt`
- **Conflict handling:** GitHub's `sha` is the optimistic concurrency token. PUT returning `409 Conflict` triggers a conflict modal showing remote commit author + date with two actions: "Overwrite remote" (re-PUT with fresh sha) or "Pull remote first" (Restore flow)
- "Last write wins by id": Restore replaces local rows whose `id` matches incoming. Local rows with no remote counterpart are dropped (snapshot semantics — incoming JSON is the new truth)
- UI indicator: "unsynced changes" / "last synced at …" so local-vs-remote divergence is visible

**Out of scope at L1**

- GitHub OAuth Device Flow (PAT is sufficient for single-user; revisit if PAT rotation friction becomes painful)
- Per-record merge / `updatedAt`-based conflict resolution (snapshot + last-write-wins is the floor)
- Multi-file storage / per-table commits (single `data.json` keeps writes atomic)
- Auto-sync / scheduled sync / multi-device live sync
- PAT rotation reminders / expiry warnings (manual responsibility at L1; revisit at L2)
- Google Sheets backend — deferred. `SHEETS-STRUCTURE.md` retained as reference for future migration / alternative backend if requirements change

**Acceptance.** User connects PAT once, hits "Sync now" on desktop, sees `data.json` committed in their private repo. On phone, hits "Restore from GitHub" and sees the desktop's records. Adds a record on phone, hits "Sync now"; back on desktop, hits "Restore from GitHub" and sees the phone's record. Deploy a new app version; data still restorable.

**Implementation slices** (each independently shippable, in order):

1. **S0 — Design + setup docs.** Draft `docs/L1-GITHUB.md` (auth flow, API surface, conflict handling) and `docs/STORAGE-FORMAT.md` (single-file JSON schema). Includes manual PAT-creation walkthrough.
2. **S1 — Settings + auth.** Settings view with Connect form (PAT + owner/repo). Validate via `GET /user`. Persist `{ pat, owner, repo, githubLogin }` in new Dexie `settings` table (via `version(N+1).upgrade` per migration discipline).
3. **S2 — Restore from GitHub.** `GET data.json` → parse + validate `schemaVersion` → confirmation modal → Dexie transaction (clear + bulkAdd 4 tables) → store `sha` + `lastSyncedAt`. First-run handles 404 (no remote file yet) gracefully.
4. **S3 — Sync now.** Build JSON snapshot → base64 → `PUT data.json` with stored `sha`. On 200, store new `sha` + `lastSyncedAt`. On 409, fetch latest, open conflict modal.
5. **S4 — Conflict modal + status UI.** Modal shows remote commit message + author + date; "Overwrite" / "Pull first" actions. Header pill shows sync state (connected / unsynced / last synced X ago).
6. **S5 — Phone validation.** End-to-end test on Chrome Android + iOS Safari: PAT entry on mobile (clipboard paste), round-trip sync between devices, conflict scenario.

### L2 — Automation (parked)

- Automated price monitoring for tracked intentions
- Web Push reminders for commitment due dates
- JSON export / import as a format-agnostic backup alongside Sheets

Do not pull L2 items forward without explicit trigger — L1 must be validated in daily use first.

## Architecture constraints

- **Local-first.** Every feature works with zero network. Sync is additive, never gating.
- **No backend.** GH Pages is static hosting; auth flows must be client-only (PAT or OAuth token flow). If a feature requires a server, it does not fit this project.
- **User-owned data.** Sync targets go to the user's own cloud (their private GitHub repo at L1; alternative backends possible later). App never proxies user data through a service we run.
- **`@base/pwa-core` stub.** This app does not depend on the base platform's pwa-core package — `useOnline` and `usePwaUpdate` live in `src/composables/` and are owned by this app.
- **Dexie schema is frozen per version.** `version(N)` is immutable once shipped. All changes go in a new `version(N+1).stores({…}).upgrade(trans => …)` block.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-20 | `@base/pwa-core` not used; PWA composables owned locally | pwa-core is an empty stub; not worth the dependency |
| 2026-04-20 | `priorBalance` computed from DB (sum of prior principal portions), not in-memory | Order-independent, session-independent payment logging |
| 2026-04-22 | Base tier includes GH Pages install flow + Dexie migration discipline | Installability + persistence across versions is the foundational promise |
| 2026-04-22 | OAuth scope: `drive.file` | Least privilege — app only sees files it creates or the user explicitly opens via Picker |
| 2026-04-22 | Sheet layout: one spreadsheet, four tabs | Single file for the user to back up; tabs match Dexie tables 1:1 |
| 2026-04-22 | Sync model: snapshot-on-demand (manual Sync now / Restore) | Solves the "no data wipe across deploys" goal without conflict-resolution complexity |
| 2026-04-24 | GH Pages workflow uses `actions/configure-pages@v5` with `enablement: true` | First-run on a fresh repo 404s with the default (`enablement: false`); idempotent enablement makes the workflow self-heal without manual `gh api` setup |
| 2026-04-24 | Vite `base: '/planner/'` baked into config (not env-driven) | The repo name is the single source of truth for the URL; renaming the repo would break the Pages URL and require re-registering the OAuth origin for L1 — making it explicit in source surfaces that constraint |
| 2026-04-24 | In-app install button mounted in header with explicit × dismiss | Edge hides the native install path under `…` menu and Chromium engagement heuristics gate the URL-bar prompt; an always-visible discoverable button removes the discovery friction without nagging (one-click dismissal persists in localStorage) |
| 2026-04-26 | **L1 sync backend pivoted from Google Sheets to GitHub Contents API.** Single private data repo, single `data.json`, fine-grained PAT auth | Last-write-wins-by-id usage pattern (single user, two devices) eliminated the "human-editable spreadsheet" benefit that justified the Sheets choice. GitHub wins on: (a) zero GCP setup / OAuth consent / verification overhead, (b) atomic compare-and-swap via `sha` token (free conflict detection), (c) git history = audit log with diffs, (d) ~100 LOC client implementation vs. 4-tab batch update with header validation, (e) same trust boundary as the source repo. Tradeoff accepted: editing data outside the app on mobile becomes awkward (GitHub web UI vs. Sheets app) — but actual usage hasn't required this. Sheets remains a viable future alternative; `SHEETS-STRUCTURE.md` retained as reference |
| 2026-04-26 | PAT chosen over GitHub OAuth Device Flow at L1 | Single-user personal app; PAT scoped to single repo with `Contents: read+write` and 90-day expiry has acceptable blast radius (data only, instantly revocable). Device Flow requires registering an OAuth App for marginal security uplift. Revisit if PAT rotation friction becomes painful |
| 2026-04-26 | PAT stored in IndexedDB (not in-memory) | Reverses the "in-memory only" decision from 2026-04-22 (which assumed short-lived OAuth tokens). PATs are long-lived by nature and re-pasting on every reload is hostile UX. Storage is on the same device as the data; threat model is "device compromise" which already loses everything |
| 2026-04-26 | Single `data.json` (not per-table files) | One commit = one consistent snapshot, no partial-write states, atomic `sha` concurrency token applies to the whole snapshot |

## Glossary

- **Commitment** — recurring fixed obligation (mortgage, loan, subscription)
- **Payment** — actual logged payment against a commitment
- **Intention** — mid-horizon plan item with lifecycle status
- **Market entry** — price / availability observation for an intention
- **Snapshot-on-demand** — manual full-state push / pull between Dexie and Sheets, no auto-sync
