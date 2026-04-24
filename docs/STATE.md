# Personal Planner — STATE

**Phase:** Base tier deployed to GH Pages, awaiting phone verification
**Last updated:** 2026-04-24
**Working tree:** clean on `main`
**Last commit:** `82e5f33` — ci: configure-pages enablement: true
**Remote:** `origin` → `https://github.com/komogortev/planner.git` (public)
**Live URL:** https://komogortev.github.io/planner/
**Dev server:** `pnpm --dir E:/Projects/apps/personal-planner dev` on `:5173` (wired into workspace `.claude/launch.json` as `personal-planner`; production preview as `personal-planner-preview` on `:4173`)

## Active target — Phone verification of deployed Base tier

App is live on GH Pages. Remaining work is hands-on device testing.

### Verification (USER, on devices)

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

## Blockers / open questions

- "Sync now" overwrite semantics when a user has hand-edited the sheet — likely needs confirmation prompt when `files.get().modifiedTime > lastSyncedAt`. Flag for L1 design.

## Follow-ups (non-blocking, captured during this session's CodeReview)

- Pin pnpm via `"packageManager": "pnpm@10.32.1"` in `package.json` for strict CI reproducibility
- Add `paths-ignore: ['docs/**', '*.md']` to workflow — skip CI on doc-only pushes
- Add `pnpm typecheck` step before `pnpm build` in CI — fail fast on TS errors before bundling
- Action runners flagged Node 20 deprecation (forced to Node 24 by 2026-06-02). Bump action versions when v5/v6 land for `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `pnpm/action-setup`
- Replace SVG icon placeholder with a real monogram/glyph before L1
- Capture STATE.md + project memory of installed PWA on phone (screenshot to docs/)

## Recently completed

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
| **L1** | queued | Google `drive.file` OAuth + Sheets snapshot-on-demand sync |
| **L2** | parked | Automated price monitoring, Web Push reminders, JSON export/import |

Full scope + acceptance criteria: `PROJECT.md`.

## Next after current target

**L1 — Durable sync (Google auth + Sheets).**

Prerequisites before starting L1:

- ~~Base tier shipped~~ ✅ done. **Still required: actually used on phone for a real period** before L1 work begins (trigger per memory guardrail).
- ~~GH Pages URL confirmed~~ ✅ `https://komogortev.github.io/planner/` — register this exact origin in Google Cloud Console for OAuth Client ID
- GCP project created (Sheets API + Drive API + Picker API enabled, OAuth consent screen in Testing mode, Client ID bound to GH Pages origin, API key for Picker origin-restricted)
- Design doc `docs/L1-OAUTH.md` drafted with flow diagrams + open schema-version reconciliation questions (not started)
