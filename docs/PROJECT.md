# Personal Planner — PROJECT

Personal planning + tracking PWA. Local-first, offline-capable, installable to phone from GitHub Pages. Google Sheets sync enables durable data across app iterations.

## Vision

A single place to track three intertwined domains of personal financial / life planning:

- **Commitments** — fixed obligations (mortgage, loan, subscription) with amortization math and actual payment history
- **Intentions** — mid-horizon wants / plans with explicit lifecycle (`considering → researching → committed → acquired → dropped`)
- **Market entries** — append-only price / availability observations per intention, for trend analysis

Runs offline on a phone. Data belongs to the user; sync is opt-in and user-controlled (their own Google Sheets).

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

### L1 — Durable sync (Google auth + Sheets)

**Goal.** User data survives app iterations (schema changes, deploys, device switches) by snapshotting to the user's own Google Sheet.

**Functional scope**

- Google Identity Services (GIS) client-side OAuth — token flow, no backend
- Scope: `drive.file` (least privilege — app only sees files it creates or the user opens via Google Picker)
- One spreadsheet named "Personal Planner Data" with four tabs mapping 1:1 to Dexie tables: `commitments`, `payments`, `intentions`, `market_entries`
- "Sync now" button: full snapshot push — read all Dexie records, overwrite each tab
- "Restore from Sheets" button: Google Picker to select a spreadsheet, pull all tabs, replace local state (with explicit confirmation — destructive)
- OAuth client ID restricted to the GH Pages origin only
- Token storage: in-memory only; user re-auths each session (acceptable for single-user personal use)
- UI indicator: "unsynced changes" / "last synced at …" so local-vs-sheet divergence is visible

**Out of scope at L1**

- Two-way auto-sync, per-record conflict resolution, operation logs
- Multi-device live sync
- Real-time collaboration
- Token persistence across sessions (refresh tokens require a backend for safe storage)

**Acceptance.** User signs in, hits "Sync now", sees their data in Google Sheets. Ships a new app version that changes a schema field; user hits "Restore from Sheets" after the update and data is intact.

### L2 — Automation (parked)

- Automated price monitoring for tracked intentions
- Web Push reminders for commitment due dates
- JSON export / import as a format-agnostic backup alongside Sheets

Do not pull L2 items forward without explicit trigger — L1 must be validated in daily use first.

## Architecture constraints

- **Local-first.** Every feature works with zero network. Sync is additive, never gating.
- **No backend.** GH Pages is static hosting; auth flows must be client-only (OAuth token flow). If a feature requires a server, it does not fit this project.
- **User-owned data.** Sync targets go to the user's own cloud (their Google Sheets). App never proxies user data through a service we run.
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

## Glossary

- **Commitment** — recurring fixed obligation (mortgage, loan, subscription)
- **Payment** — actual logged payment against a commitment
- **Intention** — mid-horizon plan item with lifecycle status
- **Market entry** — price / availability observation for an intention
- **Snapshot-on-demand** — manual full-state push / pull between Dexie and Sheets, no auto-sync
