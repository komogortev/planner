# Personal Planner — STATE

**Phase:** L1 — S1 complete + verified live. Ready for S2 (Restore from GitHub).
**Last updated:** 2026-04-26 (S1 verified end-to-end: real PAT Connect succeeds; Connected dl renders @komogortev / komogortev/planner-data / desktop-2026-04-26 / Last synced: Never)
**Working tree:** clean on `main`
**Last commit:** `5c34551` — feat: in-app install button with iOS instructions
**Remote:** `origin` → `https://github.com/komogortev/planner.git` (public)
**Live URL:** https://komogortev.github.io/planner/
**Dev server:** `pnpm --dir E:/Projects/apps/personal-planner dev` on `:5173` (wired into workspace `.claude/launch.json` as `personal-planner`; production preview as `personal-planner-preview` on `:4173`)

## Active target — L1 sync via GitHub Contents API

Multi-device usage of Base tier is in practice (mobile + desktop, distinct records on each). Need durable sync to consolidate state and survive future deploys.

**Backend:** GitHub Contents API on a private data repo (e.g. `komogortev/planner-data`). Single `data.json` snapshot. Fine-grained PAT auth. Last-write-wins by record `id` on collision. See `PROJECT.md` decision entry 2026-04-26 for the Sheets → GitHub pivot rationale.

### Prerequisites

- [x] Create private repo `komogortev/planner-data` (empty — first sync will create `data.json`)
- [x] Generate fine-grained PAT: single repo, `Contents: read+write`, 90-day expiry. Stored in password manager.
- [x] **S0 design** — `docs/L1-GITHUB.md` and `docs/STORAGE-FORMAT.md` drafted; all 4 open questions resolved (see L1-GITHUB.md → "Open question resolutions").

### Implementation slices (each shippable independently)

- [x] **S0 — Design.** `STORAGE-FORMAT.md` (data.json schema contract) + `L1-GITHUB.md` (auth, API surface, flows, conflict UX, error mapping). Open questions Q1–Q4 resolved.
- [x] **S1 — Settings + auth.** ✅ Shipped + verified 2026-04-26. `AppSettings` interface, Dexie v2 migration with `settings` table (verified IDB v20, all 5 stores present), `db/github.ts` fetch wrapper with typed `GitHubError` (kinds: unauthorized, not-found, public-repo, rate-limited, conflict, network, unknown), `stores/settings.ts` Pinia store with `useLiveQuery` on singleton row + `connect`/`disconnect`, rebuilt `SettingsView` with Connect form (Connected status reactive). Settings route already wired in `router/index.ts`. **Verified live:** error path (bad PAT → real 401 → "GitHub rejected your token..."), then happy path (real PAT → @komogortev / komogortev/planner-data / desktop-2026-04-26 Connected). Typecheck clean. **PAT propagation gotcha:** new fine-grained tokens (or repo-grant edits) take 30–60s to propagate through GitHub's API edge — manifests as 404. Worth surfacing in a future error-copy update for `not-found`.
- [ ] **S2 — Restore from GitHub.** `GET /contents/data.json` (Accept: raw) → validate snapshot (schemaVersion + recordCounts) → confirmation modal with two copies (empty local vs. populated local) → Dexie transaction (clear + bulkAdd 4 tables + write sha/lastSyncedAt atomically). 404 = first-run, surfaced as "no data.json yet" not error. **New file:** `src/db/snapshot.ts` (build/parse/validate).
- [ ] **S3 — Sync now.** Build snapshot from 4 tables → pretty-print → base64 → `PUT data.json` with stored `sha`. 200 → update sha + lastSyncedAt. 409/422 → enter conflict flow (S4). **New file:** `src/stores/sync.ts` (in-flight flag, dirty-bit, last error).
- [ ] **S4 — Conflict modal + status UI.** Modal shows remote commit author/date/message + record-count diffs; actions: Cancel / Pull remote first / Overwrite remote. Header `<SyncStatusPill>` reflects state from `useSyncStore`. **New files:** `src/components/SyncStatusPill.vue`, `src/components/ConflictModal.vue`. **Modified:** `src/App.vue` (mount pill).
- [ ] **S5 — Phone validation.** Round-trip on Chrome Android + iOS Safari. PAT clipboard paste. Conflict scenario triggered intentionally (Sync from desktop, Sync from phone without restoring, observe 409 + modal).

### Resolved design decisions (from S0)

| Q | Resolution | Source |
|---|------------|--------|
| Q1 — Restore on empty vs populated local | Same Dexie transaction flow; **different confirmation copy + button styling**. Empty: neutral "Populate". Populated: destructive "Replace local data" with data-loss warning. | `L1-GITHUB.md` → "Restore from GitHub (S2)" |
| Q2 — Payment derived fields on Restore | **Trust JSON, do not recompute.** Fields are persisted-at-log-time, not live-derived. Recomputation would silently disagree with reality (extra-principal payments, edits). Snapshot validation rejects payments missing them. | `L1-GITHUB.md` → "Open question resolutions" |
| Q3 — PAT failure modes | 7-row mapping table covering 401, 404 on repo, public-repo refusal, 404 on data.json (first-run, not error), token revoked mid-flow, rate limit, network error. Each has copy + recovery action. | `L1-GITHUB.md` → "Open question resolutions" |
| Q4 — Integrity check field | **Yes — `recordCounts` field.** Restore validates array lengths match before touching Dexie. `appVersion` also included as diagnostic-only field for `git log` debugging. | `STORAGE-FORMAT.md` → "Top-level shape" |

Additional decisions surfaced during S0:
- **Sync status detection:** dirty-bit on first cut (Pinia, flipped on any Dexie write, cleared on successful sync). Hash-based detection only if dirty-bit churns too much.
- **`deviceId` format:** `${platform}-${YYYY-MM-DD}` of first Connect, where platform = `phone | tablet | desktop` via matchMedia + UA heuristic. Used in commit messages + JSON snapshot for diagnostics.
- **Public-repo refusal:** Connect validates `repos/{o}/{r}.private === true` and refuses with explicit copy. Defense in depth — PAT scoping should prevent reaching a public repo, but a misconfigured PAT shouldn't quietly write personal data to a public repo.
- **Entity array key naming:** `marketEntries` (camelCase, matches Dexie table name 1:1) rather than `market_entries` from the deferred Sheets plan. Zero key-mapping in Restore/Sync code.

### Phone verification of Base tier (deferred — non-blocking; device usage already happening)

- [ ] Verify install (Add to Home Screen) on Chrome Android — icon, name, splash render correctly
- [ ] Verify offline reload on Chrome Android — kill network, reload, app loads from SW cache
- [ ] Verify install + offline reload on iOS Safari (different PWA constraints than Android)
- [ ] Verify data survives service-worker update: add record → trigger trivial deploy → reload → record still present in IndexedDB

### Recently shipped (this session, 2026-04-24)

- [x] Generated PWA icons via `@vite-pwa/assets-generator` (6 files in `public/`)
- [x] Updated `vite.config.ts` manifest to 4 icons inc. maskable; added `base: '/planner/'`; relative `start_url` + `scope` for subpath
- [x] Added theme-color, apple-touch-icon, apple/mobile web-app-capable meta in `index.html`
- [x] Dexie v2 migration template stub committed in `src/db/index.ts`
- [x] `.github/workflows/deploy.yml` — official Pages actions, `enablement: true` for first-run idempotency
- [x] Repo `komogortev/planner` created, initial Base push deployed (commit `82e5f33`)
- [x] Pages enabled with workflow source; live URL serving HTML + manifest + SW correctly
- [x] In-app install button: `useInstallPrompt` composable + `InstallButton.vue` mounted in header. Captures `beforeinstallprompt` (Chromium), shows iOS Safari instructions popover, auto-hides on `appinstalled` and in standalone display-mode, persistent dismiss via `localStorage['pp.installPrompt.dismissed']` (commit `5c34551`)

## Blockers / open questions

- ~~"Sync now" overwrite semantics when a user has hand-edited the sheet~~ — resolved by GitHub backend pivot: `sha` token gives free optimistic concurrency; 409 → conflict modal (see S4).
- ~~Open questions for the S0 design doc~~ — all 4 resolved 2026-04-26 (see "Resolved design decisions" table under Active target).
- None currently blocking S1.

## Follow-ups (non-blocking, captured during this session's CodeReview)

- Pin pnpm via `"packageManager": "pnpm@10.32.1"` in `package.json` for strict CI reproducibility
- Add `paths-ignore: ['docs/**', '*.md']` to workflow — skip CI on doc-only pushes
- Add `pnpm typecheck` step before `pnpm build` in CI — fail fast on TS errors before bundling
- Action runners flagged Node 20 deprecation (forced to Node 24 by 2026-06-02). Bump action versions when v5/v6 land for `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `pnpm/action-setup`
- Replace SVG icon placeholder with a real monogram/glyph before L1
- Capture STATE.md + project memory of installed PWA on phone (screenshot to docs/)

## Recently completed

- **2026-04-26** — **L1 — S1 shipped + verified (Settings + auth).** Files added: `src/db/github.ts` (GitHub fetch wrapper + typed errors + `generateDeviceId` heuristic), `src/stores/settings.ts` (Pinia singleton store with reactive `useLiveQuery`). Files modified: `src/db/schema.ts` (added `AppSettings`), `src/db/index.ts` (Dexie `version(2)` with `settings: 'id'` no-op upgrade), `src/views/SettingsView.vue` (Connect form + Connected dl + disabled S2/S3 buttons). Validation flow: PAT → `GET /user` → `GET /repos/{o}/{r}` → refuse if not private → persist. Error path verified live (bad PAT → 401), then happy path verified live (real PAT → Connected dl all fields populated). Initial 404 false alarm traced to **GitHub fine-grained PAT propagation delay (30–60s after token create or repo-grant edit)** — worth surfacing in `not-found` error copy. Token hygiene incident during diagnosis: 2 PATs leaked into chat (revoked + regenerated, third token never pasted). Reinforced "type tokens directly into terminal/form, never paste into chat" rule.
- **2026-04-26** — **L1 — S0 design complete.** Drafted `docs/STORAGE-FORMAT.md` (data.json schema contract: schemaVersion, recordCounts integrity check, appVersion diagnostic, deviceId, 4 entity arrays in exact Dexie shape) and `docs/L1-GITHUB.md` (auth flow, 4-call API surface, Connect/Restore/Sync/Conflict flows, 7-row error-mapping table, files-this-design-will-touch preview). All 4 open design questions (Q1–Q4) resolved with rationale. PAT created and stored in password manager; private data repo created. Ready for S1 implementation.
- **2026-04-26** — **L1 backend pivot: Google Sheets → GitHub Contents API.** Reassessed the locked Sheets choice given actual usage pattern (single user, two devices, last-write-wins by id, no spreadsheet-editing in practice). GitHub wins on auth simplicity (PAT vs. GIS+Picker+GCP), atomic concurrency (`sha` token = free 409 on conflict), git history as audit log, and ~100 LOC client implementation. Decision logged in `PROJECT.md` (entries dated 2026-04-26). `SHEETS-STRUCTURE.md` retained as deferred reference. New L1 plan + 5 implementation slices + S0 design questions captured below.
- **2026-04-24** — **In-app install button shipped.** Native install dialog is hidden in Edge's `…` menu (user feedback); added a small unobtrusive "Install app" button in the header with an explicit × dismiss. iOS path shows a popover with Share → Add to Home Screen instructions. Handles all four states correctly (Chromium installable, already standalone, iOS Safari, dismissed).
- **2026-04-24** — **Base tier deployed.** `komogortev/planner` created public, GH Actions workflow runs green, https://komogortev.github.io/planner/ serves HTML + manifest + SW. First-run failed on `actions/configure-pages@v5` default `enablement: false`; fixed via API enable + workflow hardening (`enablement: true`).
- **2026-04-24** — PWA icons generated, manifest expanded, base path `/planner/` set in Vite + verified end-to-end in dev (`:5173`) and production preview (`:4173`). Sharp added to `pnpm.onlyBuiltDependencies`.
- **2026-04-22** — Dev server wired into workspace `.claude/launch.json` using `pnpm --dir` flag (cwd outside worktree root wasn't accepted). Verified running on `:5173`, Dashboard renders, no console errors.
- **2026-04-22** — Icon placeholder + PWA-asset-generator config added (install + generate pending).
- **2026-04-22** — Tier plan documented (`PROJECT.md` + `STATE.md`). OAuth scope (`drive.file`), sheet layout (one workbook / four tabs), sync model (snapshot-on-demand) decisions locked.
- **2026-04-20** — L0 POC committed (`1b53887`). Three domains wired, amortization + 10/10 tests, PWA shell in dev.

## Roadmap at a glance

| Tier | Status | Goal |
|------|--------|------|
| **L0 POC** | ✅ done (`1b53887`) | Local CRUD + amortization + Dexie persistence |
| **Base** | ✅ deployed (`82e5f33`, [live](https://komogortev.github.io/planner/)) | Installable from GH Pages, offline-capable, Dexie migration discipline — pending phone verification |
| **L1** | active | GitHub Contents API sync (private data repo, single `data.json`, fine-grained PAT, snapshot-on-demand, last-write-wins by id) |
| **L2** | parked | Automated price monitoring, Web Push reminders, JSON export/import |

Full scope + acceptance criteria: `PROJECT.md`.

## Next after current target

**L2 — Automation (parked).** Automated price monitoring, Web Push reminders, JSON export/import. Do not pull forward until L1 has been validated in real daily multi-device use.
