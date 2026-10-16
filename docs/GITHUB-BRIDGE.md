# GitHub bridge: project state in the planner, tasks out as issues (Design)

**Status: accepted (owner, 2026-10-16, D-121; [DECISION-TREE.md](DECISION-TREE.md) §4).** The plan and the
recommended answers to Q1–Q6 (§9) were approved the same day. D-121 replaces D-119's GitHub Issues trial, which never
started. The MCP design
([MCP-FEEDBACK.md](MCP-FEEDBACK.md)) stays parked. G1 starts once restore-edit reconcile has merged (§10). Terms per [VOCABULARY.md](VOCABULARY.md),
invariants per [ARCHITECTURE.md](ARCHITECTURE.md) (A1, A11, A13), positioning per D-120.

## 1. Goal

The planner shows each connected project's **state as GitHub holds it**: the STATE snapshot, recent merges, and the
issues the user sent. From a project card the user can **send a task to that repo as an issue**, and optionally ask the
Claude Code GitHub Action to work on it. The planner stays the capture-anywhere layer: quick notes stay in the planner
and never go to GitHub by themselves (owner, 2026-10-15).

**Why GitHub and not an agent bridge.** The durable layer of each project already lives in its repo (STATE, roadmap,
merged PRs). Reading it there works with the PC off and needs no agent to post state. GitHub also links the two halves:
an issue the planner creates can start the Claude Code Action on GitHub's own runners, and the merge it leads to shows up
on the planner's next read.

**Not in scope:** syncing notes to GitHub, running anything on its own, writing code, files or workflows to a repo,
merging, and the MCP endpoint.

**The rule that holds throughout (owner, 2026-10-15): only an explicit request starts work.** An issue is created only
when the user taps Send on a project card. A typeless note never sends or starts anything, even when the Journal finds
it is about a project. At most a later Journal proposal (G6) opens the card's sheet pre-filled, and the user still sends.

## 2. Facts checked (2026-10-15/16)

| Fact | Finding | Source |
|---|---|---|
| Who can trigger `@claude` | Only users with **write access** to the repo, checked for issue, comment and review events. Bots and GitHub Apps are blocked unless `allowed_bots` is set. So in a public repo a stranger's `@claude` does nothing. An issue the planner creates with the **user's own token** is authored by the user, so it triggers; an issue created as a GitHub App would not | `anthropics/claude-code-action` docs/security.md |
| What the Action does | Runs Claude Code on the runner: answers questions, reviews PRs, implements changes and pushes commits, and reports progress in one comment. **Cannot** merge, approve or rebase. Runs Bash only through `allowed_tools`. Sees only the repo it was triggered in | same, README and docs/capabilities-and-limitations.md |
| The Action on a subscription | Pro/Max users store a `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) as a repo secret; no API key needed | same, docs/setup.md |
| GitHub API rate limit | Authenticated requests: 5,000 an hour (unauthenticated: 60). Only third-party sources reached in the search; read GitHub's "Rate limits for the REST API" page before G3 | search, 2026-10-16 |
| Fine-grained token lifetime | Up to 366 days under the default organisation policy (admins set 1–366). GitHub has offered optional expiry for fine-grained tokens since 2024-10. The planner must show the expiry and handle "no expiry" | GitHub changelog 2024-10-18; GitHub docs, PAT policy |
| Actions minutes | Public repos: free. Private repos on the Free plan: 2,000 Linux minutes a month | GitHub changelog 2025-12-16; pricing guides |
| **Older build vs a new widget kind** (read in `src/sync/engine.ts`) | A pulled record that fails the device's validator is **dropped with a console warning, and the cursor moves on**. An older build therefore never stores a `project` widget, and **after it updates it doesn't re-pull the row**, so that device would miss the widget for good. G2 needs a one-time re-pull (§5) | code, 2026-10-16 |

## 3. Slices

Each slice is one PR. When a slice adds something the client writes, the Worker deploys before the app (RUNBOOK
§Deploy). Each slice waits until the one before it has been in use for a few days.

| Slice | Ships | Evidence before merge |
|---|---|---|
| **G0** | This doc + D-121 (docs only) | owner review |
| **G1** | Token: Settings → Integrations (§4) | the token never appears in any response (the test searches for it); a refused token writes 0 rows; B never sees A's row |
| **G2** | Projects as a widget kind, with the one-time re-pull (§5) | an older build's widget row pushed against a stored project widget; the re-pull test |
| **G3** | Reading state on the card (§6) | snapshot cut on real STATE shapes; expired, revoked and 404 paths |
| **G4** | Sending an issue, explicit only (§7) | a project-marked note creates nothing; a retried send creates one issue; B can't send to A's repos |
| **G5** | The loop back: issue status, the Action's last line, the linked PR; "Set up Claude" help (§8) | a real issue → Action → PR → merge → card shows it |
| G6 (later) | Journal proposes "send to *project*?", which opens the G4 sheet pre-filled | its own decision |

## 4. G1: the token

- **Worker:** migration `0011` (additive) adds `integrations`: `user_id, provider ('github'), key_ct, key_iv, key_hint
  (last 4), key_version, login, expires_at (null = no expiry), created_at, updated_at`, primary key `(user_id, provider)`.
  Routes `PUT / GET / DELETE /me/integrations/github`, authenticated like `/me/models`. **One view function** returns
  `{ connected, login, keyHint, expiresAt, updatedAt }` and nothing else, the same pattern as `modelView`.
- **On paste:** the Worker calls `GET https://api.github.com/user` with the token. A 401 refuses with "GitHub rejected this
  token" and **stores nothing**. On success it seals the token with `sealKey(MODEL_KEY_SECRET, token, userId, 'github',
  'https://api.github.com')` and reads the token's expiry from the response headers when present (header `github-authentication-token-expiration`, recalled; check it in G1).
- **A13:** `integrations` joins the export (without the key) and the delete-account table list in the same PR. The
  table-list test fails if it is missing.
- **App:** `IntegrationsCard.vue` beside `ModelsCard` in Settings. It has a paste field, the connected login, the expiry
  ("expires in 12 days" turns amber at 14 days), Remove, and a **"Create a token on GitHub"** link. The link opens GitHub's
  fine-grained token page, with a short list of what to choose there: *Only select repositories*; Metadata: read;
  Contents: read; Pull requests: read; Issues: read and write. Nothing broader.
- **One token per GitHub account** (Q6: every account brings its own). Per-project tokens aren't offered: one token,
  repos chosen at GitHub.
- **`MODEL_KEY_SECRET` now protects GitHub tokens too.** RUNBOOK's "never regenerate" warning gains "and every connected
  GitHub token".

**Built (2026-10-16):** migration `0011`, `api/src/integrations.ts`, `src/integrations/` (`IntegrationsCard`, client),
account export and delete. Only fine-grained tokens are accepted (`github_pat_…`); a classic `ghp_` token is refused before
GitHub is asked. Worker tests 226 → 240, app 600 → 604. Seven negative controls, all caught: the token in the view, no
account filter on read, a GitHub 401 ignored, the table missing from delete-account, a delete without the account filter,
classic tokens accepted, a GitHub 403 taken as "rejected". The expiry header name (`github-authentication-token-expiration`) is still recalled; the first
real connect shows whether a date appears.

**Blast radius.** A leaked token is the worst failure: anyone holding it can read the chosen repos and write issues as
the user. The single-view test is written first and shown failing (R2). A wrong `0011` is additive; the undo is a
follow-up migration, and Time Travel is not needed.

## 5. G2: projects (Q2: a widget kind)

- **The Integrations card lists the repos the token reaches** (`GET /user/repos`, paged; the Worker returns `full_name`,
  `private`, `default_branch`). A switch beside each one creates or removes its project.
- **A project is a widget:** `kind: 'project'` plus one field added later, `project: { repo, private, statePath }`.
  `statePath` defaults to `docs/STATE.md` (Q1). It uses the existing `widget` record and table and its added-fields path:
  **no Dexie version and no D1 migration, so the rollback floor doesn't move.** The validator adds the kind value and the
  rule "a project widget has `project`, the others don't".
- **The one-time re-pull (from §2).** The first launch of the build that knows `project` re-pulls `widget` records once:
  it resets the record cursor to 0 for that kind, or runs a full re-pull. The existing `rewound`/`reconcile` path does a
  full one, and the account sizes allow it. It is recorded in `syncMeta` so it never runs twice. Without it, a device
  that ran an older build while a project was created never shows that project.
- **The Widgets page** lists project widgets with the system ones; each switches on and off like any widget.

**Blast radius.** A wrong widget validator rejects **every widget push from every device**: Dashboard switches stop
syncing, and the owner sees it first as rejected changes on the sync pill. Known positive: the existing older-build
fixture pattern, applied to a project widget row.

## 6. G3: reading state (Q1, Q5)

- **Worker route** `GET /projects/:owner/:repo/state` (the account from the session; the repo must be one of the
  account's project widgets, otherwise 404). It reads, with the stored token:
  1. `statePath` through the contents API, cut at its snapshot section. Today that is the `## SNAPSHOT` heading through
     the first `---` line, ≤ 2 KB by the workspace's STATE contract. If neither marker is found it falls back to the
     first 40 lines, and the card says "no snapshot section".
  2. The last 5 merged PRs (`GET /repos/:r/pulls?state=closed&sort=updated`, keeping those with `merged_at`).
  3. Open issues labelled `planner`, created by this login.
- **Cache:** each GitHub response's `ETag` is kept per user and repo in the Workers Cache API. A `304` answer costs no
  rate limit. Five open cards × a few refreshes a day is far under 5,000 an hour.
- **When:** on opening the card and on Refresh only, never in the background (Q5). The device keeps the last answer and
  shows its age ("3 h ago"), so the card works offline.
- **Rendering:** GitHub content is **data, not markup**. It is shown as text with bold and links only, never `v-html`. A
  link opens on GitHub.
- **Errors, each shown as a line on the card, never a crash:** 401 → "Reconnect GitHub in Settings"; 404 on the file →
  "No STATE file at `docs/STATE.md`" plus the path setting; 403 for the rate limit → "GitHub limit, try again after HH:MM".

**Blast radius.** It only reads. A wrong cut shows the wrong text on one card, and the owner sees it first.

## 7. G4: sending an issue (Q3, Q4)

- **On the card, "New issue"** opens a sheet with a title (required) and a body. **"From a note"** picks one of the user's
  notes and pre-fills the body as an **editable draft**: the raw note is never sent unread, since a note may hold several
  topics or personal content.
- **"Ask Claude to work on it":** a toggle that adds the `@claude` line to the body. It appears **only when the repo has a
  workflow using `anthropics/claude-code-action`**: the Worker lists `.github/workflows/` through the contents API once and
  caches the answer for a day.
- **Public repo (Q4):** before Send, the sheet says "*owner/repo* is public: this issue will be public". The user decides.
  There is no automatic rerouting.
- **Online only (Q3):** Send waits for GitHub's answer and shows the issue link. Nothing is queued or replayed.
- **No duplicate on retry:** the sheet makes a request id, and the Worker writes it into the body as an HTML comment
  (`<!-- planner:<id> -->`). Before creating, it searches the repo's `planner`-labelled issues for that id. A retry after a
  lost response gets the existing issue back.
- **Label `planner`** on every issue sent; the Worker creates the label if the repo lacks it. That label is how G3 and G5
  find "issues the planner sent".

**Blast radius.** An issue in a public repo can't be unsent; it can only be closed or deleted by the user on GitHub. That
is why there's the warning and the explicit tap, and why the test asserts **no issue without the tap**: a note carrying
a project marker produces zero GitHub calls. B sending to A's repo is refused before any GitHub call (the repo must be
one of B's own projects).

## 8. G5: the loop back

- **The card lists the issues the planner sent:** open or closed, the last comment line from the Action, and the PR the
  Action opened when the issue links one (the issue's timeline events). A closed issue shows for 7 days, then drops off
  the card.
- **"Set up Claude for this repo":** a help sheet, not an automation. It covers running `/install-github-app` in Claude
  Code, or adding the workflow and a `CLAUDE_CODE_OAUTH_TOKEN` secret from `claude setup-token`. **The planner never
  writes workflows**, and the token's permissions couldn't.
- **Merging stays the user's.** The next read picks up the merge and the updated STATE.

## 9. Answers (owner, 2026-10-16: the recommended answers to Q1–Q6)

| # | Question | Answer |
|---|---|---|
| Q1 | Where state comes from | `docs/STATE.md`'s snapshot by default; the path can be changed per project |
| Q2 | What a project is | A widget kind (no Dexie bump), with the one-time re-pull from §5 |
| Q3 | Issue creation | Online only |
| Q4 | A private task about a public repo | Warn and let the user decide |
| Q5 | When it reads | On open and on Refresh |
| Q6 | Who gets it | Every account, each with its own token |

## 10. Sequencing

The alpha order is unchanged: A2 tester notice → invites (the tester's invite expires 2026-10-24) → restore-edit
reconcile before the second invitee. **G0 is this PR. G1 starts once restore-edit reconcile has merged.** G2–G5 follow,
each after a few days of use of the one before. G6 and the MCP design stay parked.

## 11. Vocabulary (rows added when G1 merges)

| Term | Code name | Meaning | Not the same as | Status |
|---|---|---|---|---|
| **Integration** | D1 `integrations`, `IntegrationsCard` | An outside account connected by a pasted token, held encrypted on the Worker and never returned (GitHub first) | Model (also a pasted key, but for model calls) | G1 |
| **Project** | widget `kind: 'project'`, field `project` | A GitHub repo the user connected, shown as a card with its state and the issues sent to it | Theme (parked); Category | G2 |
