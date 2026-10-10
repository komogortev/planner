# Personal Planner — PROJECT

Personal helper PWA: capture notes quickly, organise them, and run saved AI instructions over chosen slices of them.
Local-first, offline-capable, installable from GitHub Pages; data synced to the owner's own private GitHub repo.

> **Pivot 2026-10-08.** The planner was deprecated on 2026-09-21 and reopened by owner decision as the base of a
> personal helper. The data layer (Dexie, migrations, GitHub sync, Category/Theme/Tag) carries over. The financial
> domain (commitments, payments, intentions, market entries) is **frozen**: its tables and data stay, its screens
> leave the navigation, no new work. New tiers use the **H** prefix (§Tiers). The workspace direction this
> implements: `E:/Projects/docs/architecture/05-personal-helper-direction.md` (not in this repo).

## Vision

One place where the owner writes things down without stopping to organise them, organises them later (alone or in
chat with an AI), and asks for **lenses**: saved instructions that read a slice of entries and report back in a shape
the owner chose ("today's commitments from Work, as a checklist"). The AI reads, reports and proposes; only the owner
changes records.

Vocabulary is fixed in [VOCABULARY.md](VOCABULARY.md); structure in [ARCHITECTURE.md](ARCHITECTURE.md).

## Doc map

| Doc | Role | Status |
|---|---|---|
| [STATE.md](STATE.md) | Current snapshot + next step | live |
| [VOCABULARY.md](VOCABULARY.md) | One word per concept — UI, schema, tool names, docs | live, binding |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, module boundaries, invariants, AI execution modes | live, binding |
| [STORAGE-FORMAT.md](STORAGE-FORMAT.md) | `data.json` contract | v1 text; v2 in L2 doc; after H1 frozen-domain only (entries live on the backend) |
| [L1-GITHUB.md](L1-GITHUB.md) | Sync transport, auth, conflict flow | shipped, reference |
| [L2-ORGANIZATION.md](L2-ORGANIZATION.md) | Category / Theme / Tag model, schema v3 | S1 shipped; closed by pivot |
| [H1-ENTRIES.md](H1-ENTRIES.md) | Core loop: accounts, capture page, outbox sync, backend (Worker + D1), schema v4 | S0 closed 2026-10-09 |
| [H1-S1-SPIKE.md](H1-S1-SPIKE.md) | S1 spike kickoff: owner setup, steps, CPU known positive, decision rules | ready |
| [H2-LENSES.md](H2-LENSES.md) | Slices, lenses, runs, reports, composer | S0 draft, questions open |
| [SHEETS-STRUCTURE.md](SHEETS-STRUCTURE.md) | Deferred Sheets backend | historical reference |

**Discipline (unchanged since L1):** each tier ships its `docs/<tier>-<NAME>.md` design with every open question
resolved *before* its S1 code. H3–H5 design docs are written when their S0 starts, not before.

## Tiers

### Shipped (detail in the design docs and git history)

| Tier | What | Closed |
|---|---|---|
| L0 POC | Local CRUD, amortization, Dexie persistence | 2026-04-20 `1b53887` |
| Base | Installable from Pages, offline, frozen-version migration discipline | 2026-04-24 `82e5f33` |
| L1 Sync | GitHub Contents API, single `data.json`, PAT, sha conflict modal | 2026-04-27 (real-use) |
| L2-S1 Categories | Schema v3, shared migrations, refuse-delete-in-use | 2026-06-01 |

### Retired by the pivot

| Was | Fate |
|---|---|
| L2-S2 Tags | → H1 (tag input built for entries, reused by frozen screens if ever needed) |
| L2-S3 Themes | → H4 (themes UI, with AI-proposed themes) |
| L2-S4 Dashboard surfacing | Dropped — lenses replace dashboard roll-ups |
| L2-S5 Sync round-trip + intentional 409 | → H1, then superseded 2026-10-09: entries sync per record through the backend; replay and isolation tests replace the 409 drill |
| L3 Mobile UX & insight | Capture-relevant items (install race, dismissal escape hatch, FAB quick-add, mobile IA) → H1. Financial insight dropped |
| L4 Automation | Web Push → H5 (capped notifications). Price monitoring dropped. JSON export: the nightly backend export to the private data repo (H1) |

### H-tiers (the helper)

| Tier | Goal | Exit condition | Design doc |
|---|---|---|---|
| **H0 Pivot design** ✅ | Vocabulary, architecture, tier plan, H1/H2 drafts | Docs merged (#7); vocabulary confirmed 2026-10-09 | this set |
| **H1 Core loop** | Invite-only accounts (Google/GitHub sign-in); capture page as home, offline; outbox sync with the backend (Cloudflare Worker + D1) that cleans, stores and serves entries; financial screens out of nav | A week of daily capture on phone + desktop: every entry on both devices and the backend, offline-then-reload keeps unsynced status, replayed push = one entry, second account isolated | [H1-ENTRIES.md](H1-ENTRIES.md) |
| **H1b Organise** | Categories and tags synced through the backend; Inbox view; tag input; category rules | Entries organised on the desktop show organised on the phone | `H1B-ORGANISE.md` at its S0 |
| **H2 Lenses** | Slices + lenses + reports; one pure composer; **lens trial first**: Claude Code runs lenses read-only over the nightly entries export before any lens UI | Owner keeps at least one lens after two weeks of trial; composer reproduces the trial prompts | [H2-LENSES.md](H2-LENSES.md) |
| **H3 Agent surface** | Remote MCP endpoint on the backend: read/run/propose tools, audit table, MCP OAuth — reachable from Claude Code and the Claude phone app | A lens run from Claude (desktop or phone) writes a report the app shows | `H3-AGENT.md` at its S0 |
| **H4 Curation & tasks** | Proposal queue UI; Task record; themes UI; AI-proposed categories/rules/tags/themes | A curation session's proposals accepted in the app; a lens yields accepted tasks | `H4-CURATION.md` at its S0 |
| **H5 In-app AI** | One model gate, one scheduler, capped notifications; first scheduled lens | A morning lens arrives with no session open | `H5-IN-APP-AI.md` at its S0 |

Order is strict through H3 (H1b sits between H1 and H2). H4 and H5 may swap on owner call; H5 is the first tier that spends money (API key).

## Architecture constraints

- **Local-first.** Capture and browsing work with zero network. Sync is additive, never gating.
- **One hosted backend, free tier first** (changed 2026-10-09). The client stays static on Pages; the backend is a
  Cloudflare Worker + D1. Budget $0, the $5/month Workers Paid plan allowed when limits are reached. No other hosted
  service without a decision-log entry.
- **Accounts, invite-only, multi-tenant.** Every backend row belongs to one account; the backend takes the account
  from the session, never from the request. Sign-in is Google or GitHub OAuth; no passwords stored.
- **Data custody.** Entries live on the device (cache) and on the backend, which may read them (no end-to-end
  encryption, owner decision 2026-10-09). The owner keeps a copy through a nightly export to the private data repo.
  The model provider sees content only at run time, for the entries in the slice being run.
- **This code repo is public.** No personal data, no real entries, no employer content in code, fixtures or docs.
  Built-in lens instructions are public by design.
- **Dexie versions are frozen once shipped.** Changes go in `version(N+1).upgrade(...)`; the same per-row migration
  function serves the DB upgrade and the snapshot restore (`src/db/migrations.ts`).
- **Domain logic is environment-free.** Slice resolution and prompt composition (H2) import no Dexie, Vue or DOM, so
  the PWA and the H3 server run the same code (ARCHITECTURE §3).
- **`@base/pwa-core` not used.** PWA composables live in `src/composables/`.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-20 | `@base/pwa-core` not used; PWA composables owned locally | pwa-core is an empty stub; not worth the dependency |
| 2026-04-20 | `priorBalance` computed from DB (sum of prior principal portions), not in-memory | Order-independent, session-independent payment logging |
| 2026-04-22 | Base tier includes GH Pages install flow + Dexie migration discipline | Installability + persistence across versions is the foundational promise |
| 2026-04-22 | OAuth scope: `drive.file` | Least privilege — app only sees files it creates or the user explicitly opens via Picker |
| 2026-04-22 | Sheet layout: one spreadsheet, four tabs | Single file for the user to back up; tabs match Dexie tables 1:1 |
| 2026-04-22 | Sync model: snapshot-on-demand (manual Sync now / Restore) | Solves the "no data wipe across deploys" goal without conflict-resolution complexity |
| 2026-04-24 | GH Pages workflow uses `actions/configure-pages@v5` with `enablement: true` | First-run on a fresh repo 404s with the default (`enablement: false`); idempotent enablement makes the workflow self-heal without manual `gh api` setup |
| 2026-04-24 | Vite `base: '/planner/'` baked into config (not env-driven) | The repo name is the single source of truth for the URL; renaming the repo would break the Pages URL and require re-registering the OAuth origin for L1 — making it explicit in source surfaces that constraint |
| 2026-04-24 | In-app install button mounted in header with explicit × dismiss | Edge hides the native install path under `…` menu and Chromium engagement heuristics gate the URL-bar prompt; an always-visible discoverable button removes the discovery friction without nagging (one-click dismissal persists in localStorage) |
| 2026-04-26 | **L1 sync backend pivoted from Google Sheets to GitHub Contents API.** Single private data repo, single `data.json`, fine-grained PAT auth | Last-write-wins-by-id usage pattern (single user, two devices) eliminated the "human-editable spreadsheet" benefit that justified the Sheets choice. GitHub wins on: (a) zero GCP setup / OAuth consent / verification overhead, (b) atomic compare-and-swap via `sha` token (free conflict detection), (c) git history = audit log with diffs, (d) ~100 LOC client implementation vs. 4-tab batch update with header validation, (e) same trust boundary as the source repo. Tradeoff accepted: editing data outside the app on mobile becomes awkward (GitHub web UI vs. Sheets app) — but actual usage hasn't required this. Sheets remains a viable future alternative; `SHEETS-STRUCTURE.md` retained as reference |
| 2026-04-26 | PAT chosen over GitHub OAuth Device Flow at L1 | Single-user personal app; PAT scoped to single repo with `Contents: read+write` and 90-day expiry has acceptable blast radius (data only, instantly revocable). Device Flow requires registering an OAuth App for marginal security uplift. Revisit if PAT rotation friction becomes painful |
| 2026-04-26 | PAT stored in IndexedDB (not in-memory) | Reverses the "in-memory only" decision from 2026-04-22 (which assumed short-lived OAuth tokens). PATs are long-lived by nature and re-pasting on every reload is hostile UX. Storage is on the same device as the data; threat model is "device compromise" which already loses everything |
| 2026-04-26 | Single `data.json` (not per-table files) | One commit = one consistent snapshot, no partial-write states, atomic `sha` concurrency token applies to the whole snapshot |
| 2026-04-27 | **L1 declared closed in real-use after cross-device round-trip validation; intentional 409 deferred to L2-S5** | User validated bidirectional sync (force-push from one device, pull-with-overwrite on others — both directions confirmed). The trust S5 was meant to establish (sync is reliable cross-device with deterministic override semantics) is established. Formal phone-Chrome / iOS-Safari checklist is symbolic at this point. Intentional 409 conflict scenario remains untested — folded into L2-S5 sync round-trip validation, where snapshot shape changes anyway and new arrays make the conflict scenario more meaningful to exercise |
| 2026-04-27 | **Roadmap restructured: L2 redefined as Organization (was Automation); old L2 demoted to L4** | Real next-theme direction emerged from lived use: user feels the lack of organization across entries (cross-cutting linking under common goals) more acutely than the lack of automation. Strategic abstraction work in 2026-04-27 planning session surfaced this. Automation (Web Push, price monitoring, JSON export/import) remains valuable but is now a follow-tier, gated on L3 mobile-UX validation |
| 2026-04-27 | **L2 model: three layers (Category single-pick + Theme cross-cutting many-to-many + Tag free folksonomy), not tags-only** | User mental model implicitly distinguishes *the bucket the thing IS in* (Category, single-valued) from *the goal it CONTRIBUTES to* (Theme, multi-valued, with own metadata + progression). Tag-only systems conflate these and drift on synonyms. Industry pattern (Things, Notion, Linear, Obsidian) consistently layers all three. Tags sit on top as ad-hoc filter primitive, additive not replacing |
| 2026-04-27 | **L3 mobile UX deferred until after L2-S4 lands** | Themes change what the dashboard renders and what list-views need to surface. Designing density / card behavior / dashboard rollups before the organization layer is in place is premature. Two specific pain points captured for L3 in the meantime: install button mount-timing race in `useInstallPrompt.ts:93` (`beforeinstallprompt` can fire before Vue mounts; spec doesn't replay), and dismissal escape hatch (`useInstallPrompt.reset()` exists but no UI wires it) |
| 2026-09-21 | **Deprecated** — no continuation planned (owner) | Partially absorbed by the owner's vault + Claude-in-the-loop. Deployment stayed up |
| 2026-10-08 | **Reopened as the personal helper — pivot, not a new repo** (owner) | The data layer the helper needs (sync, conflict flow, migrations, taxonomy, PWA install, deploy) sits in 3,859 of the 5,733 source lines (files outside the financial domain, measured 2026-10-09; schema, migrations and snapshot also carry financial parts) and is already in daily use on the owner's devices. A new repo would rebuild it and lose history, deployment and installs |
| 2026-10-08 | **Financial domain frozen in place, not deleted** *(2026-10-09: deletion candidate, see below)* | Deleting its tables is a Dexie version that wipes data on every device; recovery would be only the old snapshots in the data repo history. Hiding the screens costs nothing and keeps the option open |
| 2026-10-08 | **New tiers use the H prefix; old L3/L4 retired with a mapping, not renumbered** | Reusing L3/L4 for new meanings would make older references ambiguous |
| 2026-10-08 | **No markdown trial before building; the lens trial runs over the real snapshot (H2)** | With entries in the real app, Claude Code can run lenses read-only over the synced `data.json`: the same test of lens value, on real data, with nothing to import later. *2026-10-09: entries leave `data.json`; the trial reads the nightly export instead (H2-LENSES Q1)* |
| 2026-10-08 | **AI integration: outside first (Claude Code over local MCP, H3), inside later (H5)** | Outside runs on the existing subscription; inside needs an API key billed per token and is needed only for runs with no session open. *2026-10-09: "local MCP" becomes a remote MCP endpoint on the backend; outside-first stands* |
| 2026-10-08 | **"Lens" names the saved AI instruction; "Commitment" stays the frozen financial record** | "Feature" collides with product features; open loops are Tasks with `direction: 'promise'` (VOCABULARY.md). Lens is the working name pending owner confirmation |
| 2026-10-09 | **Vocabulary confirmed: Lens** (owner) — closes H0 | Alternatives Routine/Recipe rejected (VOCABULARY) |
| 2026-10-09 | **Work entries are personal obligations only, never employer content** (owner) | The office side keeps its own journal; this code repo is public and the backend reads content |
| 2026-10-09 | **Hosted backend: Cloudflare Workers + D1; entries leave `data.json`** (owner input; backend pick = working choice, H1 §11) | Owner's core loop needs a backend that authenticates, cleans, stores and serves entries. Workers + D1 is the only option compared that is free with no idle pause and runs our own code; Supabase free pauses after 7 idle days, Dexie Cloud runs no server logic, Firebase functions need billing. Per-record sync removes the whole-snapshot 409 entry-loss hazard. Supersedes "No hosted backend" and the 2026-10-08 record-level-merge plan |
| 2026-10-09 | **Accounts invite-only and multi-tenant; Google/GitHub sign-in; backend may read content; $0 now, $5 later** (owner) | Multi-tenant schema costs little now and avoids a rewrite; invite-only defers abuse handling and public terms. Server-readable content is what cleaning, query, server lenses and the remote MCP endpoint need |
| 2026-10-09 | **H1 narrowed to the core loop; organising moves to a new H1b** | The first loop is capture → sync → serve; organising needs the backend to exist. `Entry.categoryId` and `tags` ship in H1 so H1b needs no entry migration |
| 2026-10-09 | **Frozen financial data stays frozen and is a deletion candidate** (owner) | Not scheduled; it never moves to the backend. Deleting is irreversible, so it needs the owner's explicit go, and a final export of the frozen tables comes first: dropping tables in a Dexie version wipes them on every device, and the data repo's history would be the only other copy |
| 2026-10-09 | **Local eviction cut from H1; the device keeps a full copy** (owner) | Text grows ~4 MB a year, so the budget would not bind for years, and the exit week could not exercise the code path. Saves ~0.5 session. Re-enters when local usage passes 50 MB or attachments are scoped |
| 2026-10-09 | **H1 §12 Q3–Q9 defaults confirmed; the planner takes workspace priority until further notice** (owner) | Closes S0. engine-dev's Release 1 tracks pause in place; nothing there is abandoned |
| 2026-10-09 | **Auth = own OAuth code + Hono + own `sessions` table** (S1, closes H1 Q1) | Arctic was deprecated by its maintainer 2026-07; Better Auth is 210 KB gz and cannot be cheaper on CPU. Measured p50 1–5 ms per route on the free plan |
| 2026-10-10 | **Vibe-code mode: Claude owns code structure, architecture and the deploy chain** (owner) | Owner: "attempt to fully rely on you for code structure and architecture". Claude decides and records; money, publishing and irreversible deletes still go to the owner. Merges of planner PRs by Claude via a repo-scoped permission rule |
| 2026-10-10 | **Production only runs `main`; merge on green** (owner asks; Claude built) | Worker deploys through a guard (clean tree, on `main`, equal to origin; version tagged with the sha) — Cloudflare recorded no source for hand deploys. CI runs `pnpm check` on every PR; a `main` ruleset requires it; repo auto-merge on — tests had only ever run on one machine |
| 2026-10-10 | **Version badge on every page, in every environment, prod included — for now** (owner) | A glance tells which build is being tested (`v<version> · <commit> · <built>`); paired with the env cue (local amber, preview fuchsia, prod unchanged). **Re-entry: the S4 cut-over** (first live production use) — decide then whether prod keeps the badge |
| 2026-10-10 | **S1 spike closed: A ✅ B ✅, C (iPhone) deferred** (owner: his phone is Android) | The exit week runs on Android, whose installed-app sign-in return behaves like desktop Chromium. C re-enters before the first invitee with an iPhone/iPad; the handoff-by-polling fallback is additive to the backend, so S2 does not wait on it |

## Glossary

Moved to [VOCABULARY.md](VOCABULARY.md), which is binding for new work. Frozen financial terms are listed there under
"Frozen domain".
