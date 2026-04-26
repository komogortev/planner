# Personal Planner — STATE

**Phase:** L1 — S3 implemented + structurally verified. Ready for live PAT round-trip + S4 (conflict modal).
**Last updated:** 2026-04-26 (S3 implemented: useSyncStore + syncNow action + putDataJson + dirty-bit via Dexie hooks + UTF-8 base64 encoder + Sync button & dirty pill in SettingsView. 37/37 tests pass; vue-tsc clean; structural verification confirmed both stores wired, settings shrunk to credentials surface, sync surface includes inFlight/dirty/syncError/restoreError/pendingRestore/pendingConflict/syncNow/etc., Dexie hook fires on real db instance (clearAllData → dirty=true), all 6 connected-state buttons render incl. new Sync now + Unsynced changes pill. Live PAT-based round-trip pending — assistant cannot paste PAT.)
**Working tree:** S3 changes uncommitted on `main`
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
- [x] **S1 — Settings + auth.** ✅ Shipped + verified 2026-04-26. `AppSettings` interface, Dexie v2 migration with `settings` table (verified IDB v20, all 5 stores present), `db/github.ts` fetch wrapper with typed `GitHubError` (kinds: unauthorized, not-found, public-repo, rate-limited, conflict, network, unknown), `stores/settings.ts` Pinia store with `useLiveQuery` on singleton row + `connect`/`disconnect`, rebuilt `SettingsView` with Connect form (Connected status reactive). Settings route already wired in `router/index.ts`. **Verified live:** error path (bad PAT → real 401 → "GitHub rejected your token..."), then happy path (real PAT → @komogortev / komogortev/planner-data / desktop-2026-04-26 Connected). Typecheck clean. **PAT propagation gotcha:** new fine-grained tokens (or repo-grant edits) take 30–60s to propagate through GitHub's API edge — manifests as 404. Now surfaced in `not-found` copy on both `getRepo` and `getDataJson` paths (S2 bundled this follow-up).
- [x] **S2 — Restore from GitHub.** Implemented + verified live 2026-04-26 (commit `5f4f9f9`). **New files:** `src/db/snapshot.ts` (Snapshot type + `parseSnapshot` + `validateSnapshot` + `SnapshotValidationError` with kinds: invalid-json, wrong-shape, newer-version, count-mismatch, missing-derived-fields), `src/db/__tests__/snapshot.test.ts` (9 tests, all green), `src/components/ConfirmRestoreModal.vue` (two-variant modal: neutral "Populate" for empty-local, destructive "Replace local data" with red warning for populated-local; 4-row diff table). **Modified:** `src/db/github.ts` (`getDataJson` using JSON wrapper not raw — single response gives both content+sha, base64 decoded via `atob` + `TextDecoder('utf-8')` to preserve non-ASCII; `getRepo` not-found copy updated with PAT-propagation hint), `src/stores/settings.ts` (`fetchAndPrepareRestore` + `applyPendingRestore` + `cancelPendingRestore` + reactive `restoreInFlight`/`restoreError`/`pendingRestore`; atomic Dexie tx writes 5 stores including `settings.lastKnownSha` + `lastSyncedAt`; `disconnect()` also clears pending state to prevent stale-credential apply), `src/views/SettingsView.vue` (Restore button wired, inline error rendering, modal mounted), `docs/L1-GITHUB.md` (JSON-wrapper deviation note + propagation copy). **Verified:** 19/19 vitest pass, vue-tsc typecheck clean, zero console errors at runtime, both modal variants render with correct headers/buttons/warning state via injected `pendingRestore`, error path triggers `restoreError` correctly when not connected, **live first-run case verified end-to-end (real PAT → 404 from `/contents/data.json` → updated copy renders verbatim)**. Happy-path round-trip + restore atomicity + count-mismatch case will exercise once `data.json` exists in the repo (S3's job is to create it).
- [x] **S3 — Sync now.** Implemented 2026-04-26. **New files:** `src/stores/sync.ts` (Pinia setup-store: inFlight / syncError / restoreError / dirty / pendingRestore / pendingConflict + `syncNow` + restore actions moved from settings + `markDirty` + `reset`), `src/db/syncTracking.ts` (one-shot Dexie creating/updating/deleting hook registration on the 4 entity tables → `syncStore.markDirty()`), `src/db/__tests__/github.test.ts` (12 cases: putDataJson 200/201/409/422/401/403-rate-limited/network/utf8-encode/sha-omission, getDataJson 404-with-propagation-hint/utf8-decode/200). **Modified:** `src/db/snapshot.ts` (+`buildSnapshot` reading 4 tables → assemble Snapshot, +`serializeSnapshot` 2-space pretty-print), `src/db/github.ts` (+`putDataJson` JSON wrapper PUT, +`encodeUtf8Base64` chunked TextEncoder→btoa mirror of `decodeBase64Utf8`), `src/stores/settings.ts` (stripped restore state; `disconnect()` calls `useSyncStore().reset()` first to prevent stale-credential apply), `src/views/SettingsView.vue` (Sync button primary, routed restore through syncStore, dirty pill amber, sync error inline incl. pendingConflict mention, single inFlight gate over both flows), `src/main.ts` (calls `setupSyncDirtyTracking(useSyncStore())` after `app.use(pinia)`). **DevDep added:** `fake-indexeddb@6.2.5` (test-only, ~1MB, used by buildSnapshot tests). **Verification:** 37/37 vitest pass (10 amortization + 12 github + 15 snapshot incl. round-trip + buildSnapshot DB-round-trip with 🏠/café), vue-tsc typecheck clean, both Pinia stores correctly wired post-reload, settings surface correctly shrunk (only `connect`/`disconnect`/`settings`/`isConnected` exposed), sync surface fully populated, Dexie hooks confirmed firing on real db (clearAllData → dirty=true), all 6 connected-state buttons render incl. Sync now + Unsynced changes pill. **Pending live:** real-PAT first-Sync (creates data.json), Restore round-trip (closes S2 happy-path arc), 409 conflict trigger (sets up S4).
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
- **S2 follow-ups:** modal lacks focus trap (acceptable for v1 single-user); `ConfirmRestoreModal` pattern should be the template for `ConflictModal` in S4; ✅ extracted `restore*` state into `useSyncStore` (S3, 2026-04-26)
- **S3 follow-ups:** `appVersion` in `sync.ts` is hardcoded `'0.1.0'` — switch to Vite define (`__APP_VERSION__`) or `import pkg from '../../package.json' assert { type: 'json' }` so it tracks `package.json` automatically; Sync button copy might benefit from a relative time hint (e.g. "Synced 5m ago" vs "Sync now") once S4's status pill lands; consider adding a `pnpm typecheck` workflow step before build (also flagged in earlier follow-ups)

## Recently completed

- **2026-04-26** — **L1 — S3 implemented (Sync now).** New `useSyncStore` (Pinia setup-store) owns sync + restore state with single `inFlight` gate; `useSettingsStore` shrinks to credentials only (`disconnect` resets sync store first). `syncNow` builds snapshot via `buildSnapshot()` (reads 4 Dexie tables) → pretty-prints via `serializeSnapshot()` → PUTs to `data.json` via new `putDataJson()` (JSON wrapper, UTF-8-safe chunked base64 encode mirroring S2's decode). On 200, updates `lastKnownSha` + `lastSyncedAt`, clears dirty. On 409/422, re-fetches latest remote and stashes as `pendingConflict` for S4's modal to consume. Dirty-bit wired via one-shot Dexie creating/updating/deleting hooks on the 4 entity tables (settings table writes excluded), idempotent across HMR. `setupSyncDirtyTracking(useSyncStore())` called from `main.ts` immediately after `app.use(pinia)`. SettingsView gains Sync button (primary), amber "● Unsynced changes" pill, sync error banner with pendingConflict diagnostic; restore wiring rerouted from `settingsStore.*` to `syncStore.*`. Restore flow now also clears dirty + pendingConflict on success (post-restore matches remote sha). 12 new vitest cases for putDataJson + getDataJson error mapping; 6 new buildSnapshot/serializeSnapshot cases using fake-indexeddb (added as devDep) — 37/37 pass total. Live: structural verification confirmed all wiring (stores, hooks, surface shrink). Real-PAT round-trip pending.
- **2026-04-26** — **L1 — S2 shipped + verified live (Restore from GitHub).** New module `src/db/snapshot.ts` (pure parse/validate, 5 error kinds). New component `ConfirmRestoreModal.vue` (empty vs populated variant, diff table, destructive styling). New `getDataJson` in `db/github.ts` using JSON wrapper (decided over `Accept: vnd.github.raw` — single response includes both `content` and `sha`, eliminating second metadata round-trip; base64 decoded UTF-8-safe via `atob` + `TextDecoder` for non-ASCII notes/emoji). `useSettingsStore` extended with `fetchAndPrepareRestore` / `applyPendingRestore` / `cancelPendingRestore` (atomic Dexie tx over 5 stores writes `lastKnownSha` + `lastSyncedAt` in same transaction as entity bulkAdds). `disconnect` clears pending restore to prevent stale-credential apply. PAT-propagation hint added to BOTH `getRepo` and `getDataJson` 404 paths (S1 follow-up bundled). 9 new vitest cases covering invalid-json, wrong-shape, missing-derived-fields, newer-version, count-mismatch — all green; existing 10 amortization tests untouched. Vue-tsc typecheck clean. Both modal variants (Populate vs Replace) verified rendering correctly via Pinia state injection in dev preview. Live PAT round-trip pending — assistant cannot paste real PATs.
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
