# Personal Planner — STATE

## SNAPSHOT
- **Phase/Last:** H1 S0 closed (2026-10-09) — spec v2 merged (#8, #10), §12 defaults confirmed. **Planner has workspace priority until further notice (owner).** Core loop: invite-only accounts (Google/GitHub), capture page as home, outbox sync to a Cloudflare Worker + D1 backend. Docs only.
- **Working:** deployed app (https://komogortev.github.io/planner/) — L1 sync, L2-S1 categories, frozen financial domain. 54/54 vitest at last run (2026-06-01, not re-run).
- **Broken:** sync's "unsynced" flag lives only in memory (`src/stores/sync.ts:55`) — offline write, close, reopen → status no longer says unsynced. Fixed by the H1 outbox.
- **Blocker:** none for S1. Owner setup first: Cloudflare account, GitHub + Google OAuth apps (H1-S1-SPIKE §2).
- **Next:** S1 spike per `docs/H1-S1-SPIKE.md` — free-tier CPU (10 ms), iPhone home-screen sign-in, CORS; 1–2 sessions.
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
| H1 Core loop | S0 ✅; S1 spike next | H1-ENTRIES.md · H1-S1-SPIKE.md |
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

- 2026-10-09 — Planner takes workspace priority until further notice (owner); H1 §12 defaults confirmed; eviction cut.

- 2026-10-09 — Hosted backend (Workers + D1); accounts invite-only, multi-tenant, Google/GitHub sign-in; backend reads
  content; $0 now, $5 later; H1 narrowed to the core loop, organising → H1b; Lens confirmed; work entries = personal
  obligations only. Frozen financial data stays frozen and is a deletion candidate (owner; delete only on his explicit
  go, after a final export).

- 2026-10-08 — Reopened as the personal helper (pivot, not a new repo); financial domain frozen, not deleted; H-tier
  prefix; lens trial over the real snapshot instead of a markdown spike; AI outside first (H3), inside later (H5).
- 2026-09-21 — Deprecated (superseded 2026-10-08).
