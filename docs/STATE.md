# Personal Planner — STATE

## SNAPSHOT
- **Phase/Last:** H1 **S2 Backend** steps 0–5 ✅ (4 merged #32; 5 rate limit on branch/PR); client UI shell + capture shipped (#24–#28, #30): prod app `a57fd6b`, prod Worker unchanged `e87b1e4e` — step 4 is **not deployed** (needs `0004`/`0005` remote first, step 7). S1 closed (iPhone C deferred, owner on Android). Vibe-code mode (owner).
- **Working:** prod: finger-following 3-page pager (Home dictophone capture · Dashboard stub · Settings), page dots + hidden menu, coat-pocket gate with frosted-glass dialog, warm-wool dark theme and steel-blue light theme (Settings → Appearance), backdrop parallax (1/3) + cloth pull on the folds. `pnpm smoke` 12/12 · `pnpm check` app 115 · worker 18. Runbook: `RUNBOOK.md`.
- **Broken:** captured entries do not leave the device — the server side exists (`/sync/push`, `/sync/pull`, `/entries`; worker 87) but the client `sync/` loop does not. Not verified on a real Android phone: pager drag vs browser scroll, parallax/pull/blur smoothness and feel, keyboard over the dictophone window, a real provider sign-in through the gate.
- **Blocker:** none. Local dev: restart the dev server after editing `tailwind.config.ts`; `planner-api` must run for local sign-in and rejects a fake token (401).
- **Next:** step 6 auth carry-overs · 7 deploy + CPU read (gate: invitee data rights, below) → client flush/pull loop (coalesce per entity, split by size; entries list, storage usage, persist()). Owner checks on his phone first (above). Off-palette indigo remains in: btn-primary (Legacy export), update banner, input focus ring, a Settings link, status pills.
---

## Context

- **Repo:** own git, `origin` → `https://github.com/komogortev/planner.git` (**public** — no personal data in code,
  fixtures or docs). Data: private `komogortev/planner-data`, single `data.json` (8.4 KB, 2026-10-08) — after H1 it holds the frozen
  financial tables and the nightly entries export; entries themselves live on the backend.
- **Run / test / deploy:** [RUNBOOK.md](RUNBOOK.md) — `pnpm check`, `pnpm smoke[:local]`, links, deploy order. Dev: launch
  configs `personal-planner` (:5176, amber cue) + `planner-api` (:8787); `personal-planner-preview` (:4173, fuchsia; build
  first; cannot sign in — prod API refuses localhost). Merge: PR → CI `check` required → auto-merge → guarded
  `pnpm --dir api run deploy` → `pnpm smoke`.
- **Schema:** Dexie v3, snapshot `schemaVersion` 2. Next: Dexie v4 (`entries`, `outbox`, `syncMeta`) + D1 schema in H1.
- **PAT gotcha:** fine-grained tokens take 30–60 s to propagate; a 404 right after creating one is not "no access".
  Never paste a PAT into chat.

## Tier status

| Tier | Status | Doc |
|---|---|---|
| L0 · Base · L1 · L2-S1 | ✅ shipped | PROJECT.md §Tiers |
| H0 Pivot design | ✅ closed 2026-10-09 | VOCABULARY.md, ARCHITECTURE.md |
| H1 Core loop | S0 ✅ · S1 ✅ (C deferred) · S2 steps 0–5 ✅ | H1-ENTRIES.md · H1-S1-SPIKE.md · H1-S2-BACKEND.md |
| H1b Organise | planned (categories/tags sync, Inbox, rules) | PROJECT.md §Tiers |
| H2 Lenses | S0 draft, Q1–Q7 open; starts after H1 exits | H2-LENSES.md |
| H3 Agent surface · H4 Curation & tasks · H5 In-app AI | planned | PROJECT.md §Tiers |

## Carried follow-ups (still relevant after the pivot)

- **Version badge in prod** — shown on every page in every environment by owner rule (2026-10-10). Re-entry: **S4
  cut-over** — decide whether prod keeps it.
- **Invitee data rights (H1-ENTRIES §12 Q6) — PARKED gate.** Per-user export + delete-account do not exist; the owner
  hand-edits D1 today. Tester `komogorteva@…` invited 2026-10-10 (expires 10-24; sign-in only, nothing server-side
  stored yet). Re-entry: **before S2 step 4 sync goes live in production, or before any invitee beyond this tester**
  — build both, or tell the tester in writing that the owner can read and delete their data. Also open: rate limit (step 5).
- Pin pnpm via `"packageManager"` in `package.json`; `paths-ignore: ['docs/**', '*.md']` on the deploy workflow;
  bump `deploy.yml` from Node 20 (CI already runs typecheck + tests on Node 24, #20).
- PAT-expiry warning (persist `connectedAt`, warn at 75/85 days) — now only for the frozen-domain GitHub sync; low priority.
- Install-prompt mount race (`useInstallPrompt.ts:93`) + dismissal escape hatch — scheduled in H1.
- Phone verification of Base (install, offline reload, data survives SW update) — becomes part of the H1 exit week.

## Decision log

Full log: PROJECT.md → Decisions log. Latest:

- 2026-10-10 (s2) — First tester invited in production via `invite.mjs create --remote` (expires 10-24; D1 row only, no code change). No invitation-email mechanism built: the invite carries no credential, so a notification is optional; revisit (script `--send`, then Worker email + admin UI) at tester #4 or when a domain exists. Q6 export/delete parked as a gate (see follow-ups).

- 2026-10-10 — S2 step 5 (rate limit, Claude, vibe-code): Workers rate-limiting binding, not a D1 counter (an unauthenticated flood would become D1 writes against the quota it protects). Auth 20/min and push 60/min per IP (before authentication), push 20/min per account; 429 + `Retry-After`, fail-open on a broken limiter. Free-plan availability of the binding is undocumented — step 7's deploy and `smoke.mjs --rate-limit` settle it. Worker tests 71 → 87, 14 mutations caught; review: `Retry-After` exposed through CORS, IPv6 counted by /64.
- 2026-10-10 — S2 step 4 (sync, Claude, vibe-code): server side of §6 built. One data-access module (`api/src/entries.ts`, `userId` required everywhere); push = read + one D1 batch per round with a compare-and-swap on each entity's own version (a race is decided again, never overwritten; 4 rounds then `retry`); a deleted entry stays deleted when an old device edits it, the earlier text goes to revisions. Worker tests 18 → 71; 13 mutations — 2 survived the first run (revision copy guard; snapshot isolation), each got a test. Review fixes: replaced rows keep tags/category/dates (migration `0005`), `/entries?q=` off `LIKE` (D1 caps patterns at 50 bytes), renewal best-effort, byte-counted size bound. Not deployed: `0004` + `0005` are not on the remote and the invitee-data-rights gate is still parked. Known limits in H1-S2-BACKEND.md (replay after another device's edit; D1 free-plan query count to measure at step 7).
- 2026-10-10 — Session close: #24–#28 and #30 merged and deployed (`a57fd6b`). PR #29 was auto-closed when #28's branch was deleted (a stacked PR dies with its base) — replaced by #30; resolve a stacked PR against the squash-merged base with `--ours` only after confirming the diff vs main is exactly the stacked work. Parallax stays 1/3 per page (owner also said "200 vs 300 total" = 1/2; one constant `PARALLAX`). "Opacity added" = more see-through in the owner's words (memory note).
- 2026-10-10 — Pager + textile + light/dark + glass (owner asks, iterated live; PR #28): see PROJECT.md. Tuning notes worth keeping: opacity belongs on the background only (a whole-element 80% faded text and buttons); a 3x larger weave lost the cloth feel while a separate large-fold layer gave it back; folds read as 'sand dunes' at slope 3 / elevation 34 and are calm at slope 1.5 plus two placed accents; `touch-action` does not inherit past a scroll container.
- 2026-10-10 — Home capture (owner asks, Claude built): quickdraw = one textarea + Capture; `captureEntry` cleans through the shared `domain/clean.ts` and writes entry + outbox row in one Dexie transaction (empty/over-limit write nothing; a failing outbox write rolls the entry back — tested). Dexie v4 is additive. Leading whitespace is kept (cleaning trims trailing only — owner text is never rewritten). Client deployed with #26; the Worker needed no deploy (no `api/` change since prod).
- 2026-10-10 — Quiet base (owner asks, Claude built): financial screens off-nav and reachable by URL only (`/legacy`, `/commitments`…), GitHub sync folded into a collapsed "Legacy export"; nothing deleted — deletion stays on the owner's explicit go after a final export. Phone shell per his notes: swipe Home/Dashboard/Settings (no wrap), bottom zone 12% of screen height shows page dots (active = indigo accent), touch raises the menu. Sign-in gate: coat-pocket photo, orange ring over its button opens the provider dialog; route guard on the stored token; `VITE_SKIP_AUTH=1` bypasses in dev only.
- 2026-10-10 — Dev pipeline (owner asks, Claude built): production only runs `main` — the Worker deploys through a
  guard (clean tree, on `main`, equal to origin; version tagged with the sha) because Cloudflare recorded no source for
  hand deploys; CI `pnpm check` on every PR, required by a `main` ruleset, merge on green (repo auto-merge on) because
  tests had only ever run locally. Env cue + version badge (on every page, prod included, until the S4 cut-over) so a
  glance tells which build is under test — the service-worker cache had shown a stale build as "deployed".

- 2026-10-10 — S1 closed (C deferred: owner on Android); S2 started. Vibe-code mode (owner). Client moves to its own
  `*.pages.dev` origin at S4 (Claude, delegated; amends H1 Q8). Worker tests on `@cloudflare/vitest-plugin` — its
  predecessor `vitest-pool-workers` is deprecated, again visible only after install.

- 2026-10-09 — S1 session 1: own OAuth code + Hono (Arctic deprecated by its maintainer 2026-07; Better Auth 210 KB
  gz). B passes on steady state (owner) — the 9 ms GitHub callback re-enters at S2 over ≥ 50 callbacks; §4's library
  switch doesn't fit a single outlier. Review: `return_to` is an exact app-URL prefix, since github.io hosts every
  Pages site. Local secrets in `api/.env` (Claude never opens them); prod via `wrangler secret bulk`.

- 2026-10-09 — Planner takes workspace priority until further notice (owner); H1 §12 defaults confirmed; eviction cut.

- 2026-10-09 — Hosted backend (Workers + D1); accounts invite-only, multi-tenant, Google/GitHub sign-in; backend reads
  content; $0 now, $5 later; H1 narrowed to the core loop, organising → H1b; Lens confirmed; work entries = personal
  obligations only. Frozen financial data stays frozen and is a deletion candidate (owner; delete only on his explicit
  go, after a final export).

- 2026-10-08 — Reopened as the personal helper (pivot, not a new repo); financial domain frozen, not deleted; H-tier
  prefix; lens trial over the real snapshot instead of a markdown spike; AI outside first (H3), inside later (H5).
- 2026-09-21 — Deprecated (superseded 2026-10-08).
