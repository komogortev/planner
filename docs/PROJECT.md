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

### L2 — Organization (next; was Automation, demoted to L4 on 2026-04-27)

**Goal.** Entries become navigable across types under user-defined organizing concepts. Group items by *generic domain* (purchases, travel, skill development, subscriptions, …), pull cross-type collections together under common goals (e.g. "Cabin Trip" containing a travel intention + a purchase + the payments funding both), and ad-hoc-filter via free-form tags.

**Three-layer model** *(rationale below)*

- **Category** — single-pick, user-extensible controlled vocabulary. Each entity (commitment / intention / market entry) belongs to exactly one. Built-ins seeded; user can add. Answers: *"what generic domain is this?"*
- **Theme** — named cross-cutting many-to-many container with own metadata (`targetDate?`, `status`, optional target amount, progression view). Pulls items together regardless of category or entity type. Answers: *"what goal does this contribute to?"*
- **Tag** — flat, free-form, many-to-many ad-hoc folksonomy with auto-suggest from existing. Optional. Answers: *"what slice of this filter do I want right now?"*

**Why three layers, not just tags.** Pure-tag systems conflate two distinct concepts the user has implicitly distinguished: *the bucket the thing IS in* (single-valued Category) versus *the goal it CONTRIBUTES to* (multi-valued, structured Theme with its own metadata and progression). They also drift on synonyms ("travel" / "vacation") and can't carry their own data (no target date on a tag). Industry pattern aligns: Things layers Areas + Projects + Tags; Notion layers Database properties (Select) + Relations (cross-DB) + Multi-select; Linear layers Teams + Projects + Cycles + Labels; Obsidian layers Folders/properties + MOCs + Tags. Tags can sit on top of the two-layer base as an ad-hoc filtering primitive without conflict.

**Functional scope** *(provisional; locked during L2-S0 design)*

- Dexie `version(3)` migration adding `categories`, `themes`, `themeMembers` tables; nullable `categoryId` field on `commitments` / `intentions` / `marketEntries`; tags TBD (normalized join table vs. denormalized `tags: string[]` field — open question for design phase based on expected cardinality)
- Categories CRUD page; soft-disable on delete-when-in-use
- Theme list view + theme detail view (members across types, progression tile)
- Category picker on entity forms; tag input with auto-suggest; theme attach/detach UX
- Filter chips (category, theme, tag) on existing list views
- Dashboard surfacing: Active Themes tile, category breakdown
- Snapshot format change: `data.json` `schemaVersion` bump to 2; new arrays for `categories`, `themes`, `themeMembers`, `tags` (or denorm); `recordCounts` extended; backwards-compat for v1 snapshots
- Sync round-trip validation with new arrays; intentional 409 to exercise `ConflictModal` under real concurrent edit (the scenario S5 originally captured)

**Out of scope at L2**

- Automated category inference from entity text (defer; user-driven taxonomy)
- Theme templates / recipes (defer; ship empty themes first)
- Hierarchical categories (parent/child) — start flat; revisit if real lived use surfaces the need
- Per-tag color / metadata — tags stay primitive

**Acceptance.** User adds a "Cabin Trip" theme with target date, attaches a travel intention and a purchase; theme detail shows both as members and progression toward target date. Filter Intentions list by category "travel" — only travel intentions show. Sync the snapshot to GitHub; restore on another device — categories, themes, and members come back intact. Edit `data.json` directly via GitHub web UI to a stale state; trigger a Sync from the app — `ConflictModal` opens with correct counts.

**Implementation slices** *(planned during L2-S0; provisional order)*

1. **L2-S0 — Design.** Draft `docs/L2-ORGANIZATION.md` covering three-layer rationale, Dexie v3 schema, snapshot v2 format, migration plan, UI surface preview, open questions list. Resolve open questions before S1.
2. **L2-S1 — Categories.** Schema v3, CRUD page, picker on three forms, filter chip, snapshot extension.
3. **L2-S2 — Tags.** Schema, inline tag input with auto-suggest from existing, tag chip on entities, tag filter.
4. **L2-S3 — Themes.** Theme entity, theme list, theme detail with progression tile, member-attach UX.
5. **L2-S4 — Dashboard surfacing.** Active Themes tile, category breakdown.
6. **L2-S5 — Sync round-trip validation.** Full snapshot exchange with new fields; intentional 409 under real concurrent edit (closes the original S5 scenario gap).

Slice scope is provisional; locked during L2-S0 design.

### L3 — Mobile UX & insight (planned, after L2-S4)

**Goal.** Mobile experience matches industry-standard PWA ergonomics; captured data starts informing decisions, not just sitting in tables.

**Why deferred until after L2-S4.** Themes change what the dashboard renders and what list views need to surface. Designing density / card behavior / dashboard rollups before the organization layer lands would be premature.

**Provisional scope** *(do not commit until L2 is stable)*

- **Install button mount-timing race fix** — move `beforeinstallprompt` capture from `useInstallPrompt.ts:onMounted` to `main.ts` *before* `app.mount()`, surface via Pinia or module-scoped ref. The event can fire before the Vue tree mounts; the spec doesn't replay it.
- **Install dismissal escape hatch** — wire existing `useInstallPrompt.reset()` to a Settings → "Show install button again" link.
- **Tappable card primary action** — cards on mobile become primary action surface (tap-card-to-open-detail), not labels with micro-link actions.
- **FAB quick-add** — sticky floating action button per list view; defaults pre-fill from last entry.
- **Swipe gestures** on list rows (delete / archive / log payment).
- **Mobile information-architecture pass** — collapsible sections, denser card design, sticky filter chips, mobile-only summary headers, reduced visual hierarchy depth.
- **Storage → insight surfacing** — net-worth / total-debt / monthly-obligation roll-ups on Dashboard; cash-flow report from payments; intention-impact preview ("if I move this to *committed*, here's the cash-flow change"); intention price-trend callouts.
- **PAT-expiry warning UX** — persist `connectedAt` on settings row when `connect` succeeds; soft warning at 75 / 85 days. Manual re-paste is the worst case.

### L4 — Automation (parked; was old L2 before 2026-04-27 restructure)

- Automated price monitoring for tracked intentions
- Web Push reminders for commitment due dates
- JSON export / import as a format-agnostic backup alongside Sheets

Do not pull L4 items forward without explicit trigger after L3 lands.

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
| 2026-04-27 | **L1 declared closed in real-use after cross-device round-trip validation; intentional 409 deferred to L2-S5** | User validated bidirectional sync (force-push from one device, pull-with-overwrite on others — both directions confirmed). The trust S5 was meant to establish (sync is reliable cross-device with deterministic override semantics) is established. Formal phone-Chrome / iOS-Safari checklist is symbolic at this point. Intentional 409 conflict scenario remains untested — folded into L2-S5 sync round-trip validation, where snapshot shape changes anyway and new arrays make the conflict scenario more meaningful to exercise |
| 2026-04-27 | **Roadmap restructured: L2 redefined as Organization (was Automation); old L2 demoted to L4** | Real next-theme direction emerged from lived use: user feels the lack of organization across entries (cross-cutting linking under common goals) more acutely than the lack of automation. Strategic abstraction work in 2026-04-27 planning session surfaced this. Automation (Web Push, price monitoring, JSON export/import) remains valuable but is now a follow-tier, gated on L3 mobile-UX validation |
| 2026-04-27 | **L2 model: three layers (Category single-pick + Theme cross-cutting many-to-many + Tag free folksonomy), not tags-only** | User mental model implicitly distinguishes *the bucket the thing IS in* (Category, single-valued) from *the goal it CONTRIBUTES to* (Theme, multi-valued, with own metadata + progression). Tag-only systems conflate these and drift on synonyms. Industry pattern (Things, Notion, Linear, Obsidian) consistently layers all three. Tags sit on top as ad-hoc filter primitive, additive not replacing |
| 2026-04-27 | **L3 mobile UX deferred until after L2-S4 lands** | Themes change what the dashboard renders and what list-views need to surface. Designing density / card behavior / dashboard rollups before the organization layer is in place is premature. Two specific pain points captured for L3 in the meantime: install button mount-timing race in `useInstallPrompt.ts:93` (`beforeinstallprompt` can fire before Vue mounts; spec doesn't replay), and dismissal escape hatch (`useInstallPrompt.reset()` exists but no UI wires it) |

## Glossary

- **Commitment** — recurring fixed obligation (mortgage, loan, subscription)
- **Payment** — actual logged payment against a commitment
- **Intention** — mid-horizon plan item with lifecycle status
- **Market entry** — price / availability observation for an intention
- **Snapshot-on-demand** — manual full-state push / pull between Dexie and Sheets, no auto-sync
