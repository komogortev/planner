# Personal Planner — STATE

## SNAPSHOT
- **Phase/Last:** H0 Pivot design (2026-10-08) — reopened as the personal helper; deprecation (2026-09-21) lifted by owner. Docs only so far: VOCABULARY, ARCHITECTURE, H1/H2 S0 drafts, PROJECT tiers rewritten.
- **Working:** deployed app (https://komogortev.github.io/planner/) — L1 sync, L2-S1 categories, frozen financial domain. 54/54 vitest at last run (2026-06-01, not re-run).
- **Broken:** nothing known. Hazard to fix in H1: whole-snapshot sync drops unsynced entries on a 409 (H1 Q8).
- **Blocker:** H1 S0 open questions Q1–Q9 (Q9 is an owner policy call).
- **Next:** owner confirms vocabulary ("Lens") → close H1 Q1–Q9 → H1-S1 schema v4 + snapshot v3 + merge.
---

## Context

- **Repo:** own git, `origin` → `https://github.com/komogortev/planner.git` (**public** — no personal data in code,
  fixtures or docs). Data: private `komogortev/planner-data`, single `data.json` (8.4 KB, 2026-10-08).
- **Dev:** `pnpm --dir E:/Projects/apps/personal-planner dev` on `:5173` (launch config `personal-planner`); production
  preview `personal-planner-preview` on `:4173` (build first) at `/planner/`.
- **Schema:** Dexie v3, snapshot `schemaVersion` 2. Next: v4 / snapshot 3 in H1.
- **PAT gotcha:** fine-grained tokens take 30–60 s to propagate; a 404 right after creating one is not "no access".
  Never paste a PAT into chat.

## Tier status

| Tier | Status | Doc |
|---|---|---|
| L0 · Base · L1 · L2-S1 | ✅ shipped | PROJECT.md §Tiers |
| H0 Pivot design | 🔄 docs drafted, awaiting owner review | VOCABULARY.md, ARCHITECTURE.md |
| H1 Entries & capture | S0 draft, Q1–Q9 open | H1-ENTRIES.md |
| H2 Lenses | S0 draft, Q1–Q7 open; starts after H1 exits | H2-LENSES.md |
| H3 Agent surface · H4 Curation & tasks · H5 In-app AI | planned | PROJECT.md §Tiers |

## Carried follow-ups (still relevant after the pivot)

- Pin pnpm via `"packageManager"` in `package.json`; `paths-ignore: ['docs/**', '*.md']` on the deploy workflow;
  `pnpm typecheck` step before build in CI; bump Node-20 actions.
- `appVersion` in `src/stores/sync.ts` is hardcoded `'0.1.0'` — derive from `package.json`.
- PAT-expiry warning (persist `connectedAt`, warn at 75/85 days) — fold into H1 or H3.
- Install-prompt mount race (`useInstallPrompt.ts:93`) + dismissal escape hatch — scheduled in H1.
- Phone verification of Base (install, offline reload, data survives SW update) — becomes part of the H1 exit week.

## Decision log

Full log: PROJECT.md → Decisions log. Latest:

- 2026-10-08 — Reopened as the personal helper (pivot, not a new repo); financial domain frozen, not deleted; H-tier
  prefix; lens trial over the real snapshot instead of a markdown spike; AI outside first (H3), inside later (H5).
- 2026-09-21 — Deprecated (superseded 2026-10-08).
