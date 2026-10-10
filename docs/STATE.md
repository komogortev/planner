# Personal Planner — STATE

## SNAPSHOT
- **Phase/Last:** H1 **S2 Backend** 2026-10-10 (`H1-S2-BACKEND.md`): steps 0–3 ✅ (harness, shared `src/domain/clean.ts`, `0004`, invites). S1 closed (iPhone C deferred, owner on Android). Same day: dev pipeline — CI on PRs, merge-on-green ruleset, guarded deploy, env cue, version badge, one-screen layout. Vibe-code mode (owner).
- **Working:** prod `349515f` (app + Worker `e87b1e4e`): sign-in with nonce + invites — owner's prod sign-in and version badge confirmed 2026-10-10. `pnpm check` (app 95 · worker 18) runs locally and in CI; `pnpm smoke` 12/12. Runbook: `RUNBOOK.md`.
- **Broken:** sync's "unsynced" flag is memory-only (`src/stores/sync.ts:55`), fixed by the H1 outbox. Pages answers app routes with HTTP 404 + the SPA (console noise; gone with Cloudflare Pages at S4).
- **Blocker:** none. The `main` ruleset (CI must pass) has not yet held back a PR — first auto-merge PR is its proof (should read BLOCKED while CI runs).
- **Next:** S2 step 4 — sync push/pull/query (§6; §10 idempotency · isolation · stale-base · no resurrection), then 5 rate limit, 6 auth carry-overs, 7 CPU read (≥ 50 callbacks).
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
| H1 Core loop | S0 ✅ · S1 ✅ (C deferred) · S2 steps 0–3 ✅ | H1-ENTRIES.md · H1-S1-SPIKE.md · H1-S2-BACKEND.md |
| H1b Organise | planned (categories/tags sync, Inbox, rules) | PROJECT.md §Tiers |
| H2 Lenses | S0 draft, Q1–Q7 open; starts after H1 exits | H2-LENSES.md |
| H3 Agent surface · H4 Curation & tasks · H5 In-app AI | planned | PROJECT.md §Tiers |

## Carried follow-ups (still relevant after the pivot)

- **Version badge in prod** — shown on every page in every environment by owner rule (2026-10-10). Re-entry: **S4
  cut-over** — decide whether prod keeps it.
- Pin pnpm via `"packageManager"` in `package.json`; `paths-ignore: ['docs/**', '*.md']` on the deploy workflow;
  bump `deploy.yml` from Node 20 (CI already runs typecheck + tests on Node 24, #20).
- PAT-expiry warning (persist `connectedAt`, warn at 75/85 days) — now only for the frozen-domain GitHub sync; low priority.
- Install-prompt mount race (`useInstallPrompt.ts:93`) + dismissal escape hatch — scheduled in H1.
- Phone verification of Base (install, offline reload, data survives SW update) — becomes part of the H1 exit week.

## Decision log

Full log: PROJECT.md → Decisions log. Latest:

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
