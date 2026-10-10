# Personal Planner — STATE

## SNAPSHOT
- **Phase/Last:** H1 S1 spike session 1 (2026-10-09) — steps 0–5 done, PR #13 **open, not merged**. **A ✅** (Worker + D1 from the Pages origin, CORS clean). **B ✅ on steady state** (owner): p50 1–5 ms; one 9 ms GitHub callback open. Results: `H1-S1-SPIKE.md` §6. Planner has workspace priority (owner).
- **Working:** `api/` Worker deployed (`planner-api.komogortev.workers.dev`): GitHub + Google sign-in → one linked account, bearer token, `/me`. App unchanged: L1 sync, L2-S1, frozen financial domain.
- **Broken:** prod runs the **pre-review** Worker (origin-wide `return_to`, localhost allowed, burn/note routes) until #13 merges + redeploy. Sync's "unsynced" flag is memory-only (`src/stores/sync.ts:55`), fixed by the H1 outbox.
- **Blocker:** owner merges #13 and runs `wrangler deploy` (both blocked for Claude).
- **Next:** S1 session 2 — step 6 test screen (fix :5176 vs :5173 dev port; add sign-in nonce), step 7 iPhone, step 8 cleanup. Then S2.
---

## Context

- **Repo:** own git, `origin` → `https://github.com/komogortev/planner.git` (**public** — no personal data in code,
  fixtures or docs). Data: private `komogortev/planner-data`, single `data.json` (8.4 KB, 2026-10-08) — after H1 it holds the frozen
  financial tables and the nightly entries export; entries themselves live on the backend.
- **Dev:** `pnpm --dir E:/Projects/apps/personal-planner dev` on `:5173` (launch config `personal-planner`); production
  preview `personal-planner-preview` on `:4173` (build first) at `/planner/`.
- **Schema:** Dexie v3, snapshot `schemaVersion` 2. Next: Dexie v4 (`entries`, `outbox`, `syncMeta`) + D1 schema in H1.
- **PAT gotcha:** fine-grained tokens take 30–60 s to propagate; a 404 right after creating one is not "no access".
  Never paste a PAT into chat.

## Tier status

| Tier | Status | Doc |
|---|---|---|
| L0 · Base · L1 · L2-S1 | ✅ shipped | PROJECT.md §Tiers |
| H0 Pivot design | ✅ closed 2026-10-09 | VOCABULARY.md, ARCHITECTURE.md |
| H1 Core loop | S0 ✅; S1 spike: A ✅ B ✅, C next session | H1-ENTRIES.md · H1-S1-SPIKE.md |
| H1b Organise | planned (categories/tags sync, Inbox, rules) | PROJECT.md §Tiers |
| H2 Lenses | S0 draft, Q1–Q7 open; starts after H1 exits | H2-LENSES.md |
| H3 Agent surface · H4 Curation & tasks · H5 In-app AI | planned | PROJECT.md §Tiers |

## Carried follow-ups (still relevant after the pivot)

- Pin pnpm via `"packageManager"` in `package.json`; `paths-ignore: ['docs/**', '*.md']` on the deploy workflow;
  `pnpm typecheck` step before build in CI; bump Node-20 actions.
- `appVersion` in `src/stores/sync.ts` is hardcoded `'0.1.0'` — derive from `package.json`.
- PAT-expiry warning (persist `connectedAt`, warn at 75/85 days) — now only for the frozen-domain GitHub sync; low priority.
- Install-prompt mount race (`useInstallPrompt.ts:93`) + dismissal escape hatch — scheduled in H1.
- Phone verification of Base (install, offline reload, data survives SW update) — becomes part of the H1 exit week.

## Decision log

Full log: PROJECT.md → Decisions log. Latest:

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
