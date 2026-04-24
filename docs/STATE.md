# Personal Planner — STATE

**Phase:** Base tier, shipping-work in progress
**Last updated:** 2026-04-22
**Working tree:** uncommitted changes on `main` (tier docs + icon placeholder + launch config)
**Last commit:** `1b53887` — initial L0 POC
**Remote:** none yet
**Dev server:** `pnpm --dir E:/Projects/apps/personal-planner dev` on `:5173` (wired into workspace `.claude/launch.json` as `personal-planner`)

## Active target — Ship Base tier to GitHub Pages

App installable on phone from a public GH Pages URL, working offline, data surviving app updates.

Scope defined in `PROJECT.md` → "Base — Shipping scope". Checklist:

### Icons (in progress)

- [x] Place SVG source at `public/icon.svg` (generic PP monogram on `#0f172a`, accent bar — v0 placeholder)
- [x] Add `pwa-assets.config.ts` using `@vite-pwa/assets-generator` `minimal2023Preset`
- [x] Add `generate-pwa-assets` npm script + devDep pin in `package.json`
- [ ] Install `@vite-pwa/assets-generator` (`pnpm install`)
- [ ] Run `pnpm generate-pwa-assets` → produces `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`
- [ ] Update `vite.config.ts` PWA `manifest.icons` array to match generated filenames (current config lists `pwa-192x192.png` + `pwa-512x512.png` — need to add maskable entry with `"purpose": "maskable"`)

### Install surface

- [ ] Add `theme-color` + `apple-mobile-web-app-capable` + `apple-touch-icon` link in `index.html`
- [ ] Confirm GitHub repo name + account (affects Vite `base` path + OAuth origin whitelist later)
- [ ] Configure Vite `base: '/<repo-name>/'` for GH Pages subpath hosting

### Deploy

- [ ] Create public GitHub remote (name TBD)
- [ ] Add `.github/workflows/deploy.yml` — build on push to `main`, deploy `dist/` to `gh-pages` branch
- [ ] Enable Pages in repo settings (source: `gh-pages` branch)

### Verification

- [ ] Verify install + offline + reload on Chrome Android
- [ ] Verify install + offline + reload on iOS Safari
- [ ] Verify data survives service-worker update (manual test: add record → bump build → reload → record still present)

### Persistence discipline

- [ ] Document Dexie migration pattern — add a commented `version(2)` stub in `src/db/index.ts` showing the `.upgrade(trans => …)` shape as a future-reference template

## Blockers / open questions

- GitHub username + repo name not confirmed — blocks Vite `base` path and OAuth origin whitelist
- SVG placeholder acceptable for v0? (User to eyeball in preview panel before raster generation)
- "Sync now" overwrite semantics when a user has hand-edited the sheet — likely needs confirmation prompt when `files.get().modifiedTime > lastSyncedAt`. Flag for L1 design.

## Recently completed

- **2026-04-22** — Dev server wired into workspace `.claude/launch.json` using `pnpm --dir` flag (cwd outside worktree root wasn't accepted). Verified running on `:5173`, Dashboard renders, no console errors.
- **2026-04-22** — Icon placeholder + PWA-asset-generator config added (install + generate pending).
- **2026-04-22** — Tier plan documented (`PROJECT.md` + `STATE.md`). OAuth scope (`drive.file`), sheet layout (one workbook / four tabs), sync model (snapshot-on-demand) decisions locked.
- **2026-04-20** — L0 POC committed (`1b53887`). Three domains wired, amortization + 10/10 tests, PWA shell in dev.

## Roadmap at a glance

| Tier | Status | Goal |
|------|--------|------|
| **L0 POC** | ✅ done (`1b53887`) | Local CRUD + amortization + Dexie persistence |
| **Base** | 🚧 in progress | Installable from GH Pages, offline-capable, Dexie migration discipline |
| **L1** | queued | Google `drive.file` OAuth + Sheets snapshot-on-demand sync |
| **L2** | parked | Automated price monitoring, Web Push reminders, JSON export/import |

Full scope + acceptance criteria: `PROJECT.md`.

## Next after current target

**L1 — Durable sync (Google auth + Sheets).**

Prerequisites before starting L1:

- Base tier shipped and used on phone for a real period (trigger for L1, per memory guardrail)
- GH Pages URL confirmed — needed to register exact JavaScript origin in Google Cloud Console
- GCP project created (Sheets API + Drive API + Picker API enabled, OAuth consent screen in Testing mode, Client ID bound to GH Pages origin, API key for Picker origin-restricted)
- Design doc `docs/L1-OAUTH.md` drafted with flow diagrams + open schema-version reconciliation questions (not started)
