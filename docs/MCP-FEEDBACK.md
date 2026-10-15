# Project items for coding agents: a marker and a remote MCP endpoint (Design)

**Status: S0 design draft, 2026-10-14. Proposed as D-119 ([DECISION-TREE.md](DECISION-TREE.md) §4); nothing here is
accepted.** No code until the owner accepts D-119 and the open questions in §9 are answered. This is a vision change
(§6) and a new external surface (§3), so vibe-code mode does not cover it. Terms per [VOCABULARY.md](VOCABULARY.md),
invariants per [ARCHITECTURE.md](ARCHITECTURE.md) (A1, A4–A6, A11–A13), record protocol per
[HW-HARNESS.md](HW-HARNESS.md) §5 and §11, auth per [H1-S2-BACKEND.md](H1-S2-BACKEND.md).

## 1. Goal and the case that started it

A developer who uses the planner to capture notes about their own software project should be able to let their own
Claude Code session read the items they marked as being about that project. Claude Code reads them natively, as an MCP
server, with no copy and paste and no admin access.

**Case (2026-10-14).** The owner had six dev-feedback items about the planner. All six were Tasks he had added by hand
(`by: 'owner'`, no source note). Reading them took the owner's own `wrangler` login against production D1. That login
sees every account, so it can't ship. Nothing in the data told those six Tasks apart from his personal hand-added Tasks,
so the transcription was done by eye. This design fixes both problems:

1. **A marker**, set by the owner when they capture an item, saying "this is about project X" (§2).
2. **A per-user endpoint** that returns only marked items, and only the caller's own (§3–§4).

Until this ships, the owner's personal SessionStart digest (Stage 1, harness-only, outside this repo) covers his own
account. This design is the version that ships with the app.

**Privacy default.** Only items the owner marked can leave through MCP. The model never sets a marker. An unmarked
item, a note a marked Task cites, an answer, a report: none of these is readable through this surface.

## 2. Marker

### 2.1 Options

| | Carrier | Schema cost | Fits the 2026-10-14 case | Notes |
|---|---|---|---|---|
| **M-a (Recommended)** | **Task field `project: string \| null`** (a project slug; null = not marked) | Worker validator + `ADDED_FIELDS.task`; **no D1 migration** (records are JSON in `records.data`, 0008); **no Dexie version** (field not indexed; filter in memory) | Yes: all six items were Tasks | Uses the existing ADDED_FIELDS path, which already worked for `taskId`/`modelId` |
| M-b | Reserved Entry tag `project:<slug>` | none (`entries.tags` column and cleaning shipped); a reserved-prefix rule in `clean.ts` | No: the case had no notes | Capture stays typeless (D-07): the user marks the note, nothing classifies it. Good second step (§2.4) |
| M-c | Dedicated Feedback widget (D-111 clone) | widget record + a lens; D-111 filters by Journal **tags**, which Tasks don't carry yet | Partly | Couples the marker to the Journal and a model run. A marker the owner set by hand would then depend on the AI |
| M-d | A boolean `feedback` flag | same as M-a | Yes | Can't tell two projects apart. A dev with two repos would get both lists in each session |
| **M-e (Recommended, with M-a)** | **The Journal proposes the project in the run it already makes**; the owner confirms with one tap, and only then is `Task.project` set | a `taskProposal` op `project` (validator; the table exists, no Dexie bump) and one line per project in the prompt | Yes: the six Tasks enter the next run as never-assessed (`tasksWaiting`) | No second loop. Same pattern as D-111 (the Journal tags once per run) and D-105 (ask, never correct silently) |

**Why the planner didn't associate the six items itself (checked in `src/domain/harness2.ts`).** The Journal already
reads hand-added Tasks: `tasksWaiting` puts every never-assessed open Task into the next run. But it had nothing to
associate them *to*. No project exists in the schema or the prompt, and harness v2's output has no op that classifies
(create · attach · close · revise · split · merge, plus questions). The model can't know "the planner" is one of the
owner's projects unless something tells it. So the gap is missing input and a missing op. A loop isn't missing.

**Why the model proposes and doesn't set it.** The marker is the export gate. A wrong model guess would hand a personal
Task to an agent, and a guess nobody confirmed breaks the privacy default. So the model's answer is a proposal, as for
every other change to a record (A1). A rejected proposal is never made again (D-74).

**Where the Journal's project list comes from (no new record kind).** The slugs already on the account's Tasks, each
with the texts of up to three Tasks marked with it as examples. Cold start: the owner marks the first item by hand
(chip, §2.3), and from then on the Journal proposes. A project with no marked Task is never offered to the model, so it
can't invent one. A project description field waits until slugs alone prove too thin (re-entry: the owner rejects more
than a third of project proposals in a week).

**Why M-a with a slug, not a boolean.** The surface is "my Claude Code session in repo X reads what I noted about X". A
slug lets each `claude mcp add` (or each session) ask for its own project. With one project the slug costs one word.

### 2.2 Schema (M-a)

- `src/domain/records.ts`: `task.project: nullable(slug)` with `slug = /^[a-z0-9][a-z0-9-]{0,31}$/`. Add `'project'` to
  `ADDED_FIELDS.task`. An older build's Task row has no key and passes. On push, `restoreAbsent` keeps a stored marker
  when an older build edits the Task, so it is not erased.
- **Order:** the Worker deploys first (it accepts the key), then Pages, as for every ADDED_FIELDS change.
- **Dexie:** no new version. The field is not an index, and the marked list is filtered in memory (an account holds
  tens to hundreds of Tasks). **The rollback floor does not move** (RUNBOOK: never roll Pages back past a Dexie bump; there
  is none here).
- **The harness (M-e):** the prompt lists the projects in use with their example texts. The output gains a proposal op
  `{ op: 'project', taskId, project, evidence }`, valid only for an open, unmarked Task in the prompt and a project from
  the list. It is stored as a `taskProposal` with `op: 'project'` and shown on the row as "About *planner*? ✓ ✕".
  Confirming sets `project`, and the owner's chip edits stay authoritative. The model never sets or clears `project`
  itself. Adding a value to `taskProposal.op` is not an ADDED_FIELDS change: the Worker deploys first, and **how an older
  build treats an unknown op on pull must be read before S-A merges** (dropped or rejected, never a failed pull).

**Blast radius.** If the validator is wrong (for example `project` required instead of added), **every Task push from
every device is rejected**. The owner sees it first: the sync pill shows rejected changes after any Today edit, and the
tester's next tick does the same. Known positive before the merge: the existing "older build's row" fixture pattern,
extended to a Task row without `project`, pushed against a stored row that has one (the stored marker must survive). The
negative control is the same test with `'project'` removed from `ADDED_FIELDS`, which must fail.

### 2.3 Capture UI

- **Today's "+ task" box** (open view, D-106) gets a small **Project** chip: "—" by default. A tap offers the slugs this
  account already uses, plus "New project…". **Not sticky:** after each add it goes back to "—". A sticky marker would let
  personal Tasks leak into an agent's list unnoticed, which breaks the privacy default.
- **Row actions** (shown after a tap, D-104) gain **Project**: set, change or clear it on any Task, including one the
  harness made.
- A marked row shows its slug as a quiet label. There is no separate list in stage A. A per-project view is a later
  widget (D-111).

**Blast radius.** Today is the surface testers use most. A chip that crowds the "+ task" row on a phone hits the owner and
the tester first. It goes into DEVICE-CHECKS (one row: chip reachable, resets after add, label visible).

### 2.4 Notes (later, M-b)

A note captured by voice can't be marked as a Task. If the owner keeps capturing dev feedback as notes and hand-converting
them, a reserved Entry tag `project:<slug>` with the same chip on the capture surface is the next step. MCP would then
also return marked notes. Note bodies are owner text, so the privacy rule doesn't change. **Re-entry:** the owner turns a
captured note into a marked Task by hand three times in one week, or asks for it.

## 3. Endpoint

### 3.1 What was checked (2026-10-14, read from the published packages, not recalled)

| Piece | Version read | Finding |
|---|---|---|
| `@cloudflare/workers-oauth-provider` | 1.2.3 (MIT) | OAuth 2.1 authorization server + resource server for Workers. Targets the **MCP authorization spec 2026-07-28**. Publishes RFC 9728 protected-resource metadata and RFC 8414 AS metadata, issues the 401 challenge, PKCE S256 only, rotates refresh tokens. Supports pre-registered clients, **CIMD** (`clientIdMetadataDocumentEnabled`, needs the `global_fetch_strictly_public` flag) and DCR (`clientRegistrationEndpoint`; MCP 2026-07-28 deprecates DCR in favour of CIMD). **Needs a KV namespace `OAUTH_KV`**; tokens and codes are stored only as hashes, `props` encrypted. Upstream sign-in helpers (`beginConsent`/`approveConsent`/`beginUpstream`/`finishUpstream`/`completeAuthorization`) cover the GitHub/Google step and the consent page MCP requires. Grant helpers can list and revoke a user's grants (`getOAuthApi(env)` works outside a fetch handler too) |
| `agents` (Cloudflare Agents SDK) | 0.28.1 | **`McpAgent` is deprecated and feature-frozen** ("new servers should use `createMcpHandler()`"). It needs a Durable Object per session, the second billed primitive D-12 declined. `createMcpHandler()` is stateless, needs no DO, and wraps `@modelcontextprotocol/server` |
| `@modelcontextprotocol/server` | 2.3.1 (2026-10-05; 2.x since 2026-04 alphas) | Exports **`createMcpHandler(factory, opts).fetch(request, { authInfo })`**, a web-standard handler that runs in a Worker as-is, with a `cf-worker` validator. Serves 2026-07-28 and, by default (`legacy: 'stateless'`), plain 2025-era tools. **So `agents` isn't needed.** Deps: `zod`, `@modelcontextprotocol/core` |
| Claude Code (docs page, read today) | current | `claude mcp add --transport http <name> <url>`. OAuth via **DCR (default) or CIMD, discovered automatically**; `--client-id` / `--callback-port` for pre-registered clients. Tokens are stored and refreshed by Claude Code; if the AS advertises `offline_access`, refresh needs no new browser sign-in. `claude -p` and SDK runs can't do the browser flow: sign in once from an interactive session (`/mcp` or `claude mcp login <name>`) |

Not verified, and checked in S0 (§7): the KV free-plan limits (recalled as about 100k reads and 1k writes a day; read the
limits page), and whether Claude Code really takes the CIMD path against this server (known positive: a sign-in with DCR
disabled).

### 3.2 Where it runs

| | Shape | Blast radius on today's app |
|---|---|---|
| **E-a (Recommended)** | **A second Worker `planner-mcp`** (own `wrangler.toml`, own deploy) using `OAuthProvider` in its one-Worker form: it is both the AS and the only resource (`/mcp`). It binds **the same D1** (migrations stay owned by `api/`) and a new KV namespace. It reads records only through `api/src/records.ts`, imported as code | **None on sync.** `planner-api`'s export, routes and CORS don't change. A broken MCP deploy breaks only MCP. The kill switch is `wrangler delete` or a disabled route, with nothing to roll back in the app |
| E-b | Inside `planner-api`: `OAuthProvider` becomes the default export, the Hono app its `defaultHandler`, `/mcp` its `apiRoute` | Every request (`/sync`, `/auth`, `/ai/calls`) passes the provider's router first. A bug there is an outage for every tester, and the first to notice is anyone whose sync pill turns red |

E-a costs a second GitHub OAuth App. A GitHub OAuth App has one callback URL, and GitHub accepts only that URL's
host, with its path or a subdirectory of it. `planner-mcp` gets its own `workers.dev` host, so the app the planner signs
in with today can't send a person back to it. The owner registers a second app, "planner MCP", in GitHub → Developer
settings (one-time, deletable), and adds one authorized redirect URI to the planner's existing Google OAuth client. E-b
reuses both. With testers on the app, the isolation is worth that one-time step. (Not read: the callback URL registered
today, which sits in the owner's GitHub settings.)

A third shape avoids the console steps: `planner-mcp` delegates sign-in to `planner-api` (a `flow=mcp` start, the
existing callbacks, a one-time code handed back over a Service Binding). It edits `auth.ts`, the file every sign-in passes
through, so it moves risk back onto the app. Not recommended during alpha.

### 3.3 Authorization flow (E-a)

1. `claude mcp add --transport http planner https://planner-mcp.<account>.workers.dev/mcp`. The first call gets a 401 and
   the challenge. Claude Code reads the protected-resource and AS metadata and registers (CIMD), then opens the browser.
2. `GET /authorize` → `parseAuthRequest` → **consent page** (the client's name, the scopes, "only items you marked with a
   project"; Allow / Deny). MCP requires per-client consent before the upstream redirect because of the confused-deputy
   risk.
3. Allow → `beginUpstream` → GitHub or Google (PKCE, as `auth.ts` does today) → `finishUpstream` at
   `/callback/:provider`.
4. **Admission reuses the rule in `admit()` in a read-only form:** a linked identity, or an existing account by vouched
   email. **It never creates an account and never redeems an invite.** No account → "Sign in to the planner app first".
   A disabled account is refused. Shared code: `admit`'s lookup half is factored out, and the write half stays in `auth.ts`.
5. `completeAuthorization({ userId, props: { userId }, scope })` → Claude Code receives an access token (1 h) and a
   refresh token (30 days, sliding with use, matching `SESSION_DAYS`).

**Scopes:** `planner:items.read` (required for any access) · `planner:items.triage` (stage C) · `offline_access`.

**A connection is bound to projects (§10).** On the consent page the owner ticks the projects this connection may read:
one (an agent working in that repo) or all (a desktop journal session). The choice is stored in the grant's `props`
(`{ userId, projects: [...] | '*' }`), and the server adds it to every read, like the account. A session in one repo
then can't read another project's items, even the owner's own.

**Every tool call re-checks D1:** `users.id = props.userId AND disabled_at IS NULL`. KV grants outlive D1 state. Without
this check, a revoked or deleted account's agent token would keep reading until it expired. Same rule as
`authenticate()`'s join on `users`.

**Tokens don't cross over.** An MCP token is not a planner session: `/sync/*` looks it up in `sessions` and gets 401. A
planner session token at `/mcp` fails the provider's check. Both are tested (§5).

**Blast radius.** A wrong admission rule is the worst failure: an agent token bound to the wrong account, or an uninvited
person getting an account through the MCP door. Nobody would notice in normal use. Only the isolation tests in §5 catch
it, so they are written first and shown failing (R2).

### 3.4 Account lifecycle (A13)

- **Settings → Account → sessions (D-22)** also lists **agent connections**: client name, granted date, last use, and
  Revoke. `planner-api` lists and revokes grants through `getOAuthApi(env)` with the same KV bound. It imports the library,
  but nothing routes through it.
- **`DELETE /me`** also revokes every grant of the user. KV is not a D1 table, so A13's table-list test can't see it.
  That needs its own test: delete an account, and its agent token gets 401 at once (the D1 re-check), and
  `listUserGrants` is empty.
- **`/me/export`** gains `agentCalls` (§3.5).

### 3.5 Audit (A5)

New D1 table `agent_calls` (migration `0011`, additive): `user_id, at, client_id, client_name, tool, item_count,
outcome`. **No arguments text and no item text.** It goes into the A13 table list in the same PR. Settings shows the
last calls under each connection ("read 4 items · 2 h ago"). That way the user can see what the agent took.

**Rate limit:** a new `RL_MCP_USER` binding (`namespace_id` 1006, 30 per 60 s) after authentication.

## 4. Tool surface

Read first. A4: one registry (`mcp/src/tools/`), and the handlers are plain functions that take `userId`. A6: no delete,
no bulk overwrite, no tool that accepts its own proposal.

| Tool | Stage | Input | Returns |
|---|---|---|---|
| `list_projects` | B | — | `[{ project, open, total }]` for the caller's marked Tasks |
| `list_items` | B | `project?`, `state?` (`open` default · `all`), `triaged?` (bool), `since?` (opaque cursor), `limit?` (≤ 100) | `{ items: [{ id, project, text, state, due, followUpOn, createdAt, updatedAt, triagedAt, changedSinceTriage }], next }` |
| `get_item` | B | `id` | one item, same shape; **not found** for an unmarked id or another account's id. There is no 403, so the tool can't confirm that an id exists |
| `mark_triaged` | C | `ids` (≤ 50), `note?` (≤ 200 chars) | per id: `triaged` · `not_found` |

- **One shape, declared once.** MCP tools describe themselves: `tools/list` publishes each tool's input JSON Schema, and
  `registerTool` (2.3.1) also takes an `outputSchema`. A tool returns `structuredContent` that must match it. So Claude Code
  needs no client code and no copy of the shape. The item is a projection of a Task, written once in
  `src/domain/agentItem.ts` (environment-free, T7): `toAgentItem(task, triage)` plus its schema, imported by the tools. The
  Task validator stays the authority for what a Task is. A test runs `toAgentItem` over every Task fixture (including an
  older build's row without `project`) and checks each result against the published `outputSchema`, so a Task field change
  that breaks the item fails a test, not the agent. The SDK takes any Standard Schema with a JSON form, and the planner's
  validators aren't one, so the item schema is `zod` (already a dependency of the SDK) in that one file.
- **Request input only narrows.** The account (from the token) and "marked" (`project` not null) are conditions the
  server adds to every read itself, outside anything built from the request. A tool argument can only add an AND to them,
  never an OR, so no argument can widen the set. This is what makes the surface safe, whatever the agent sends. It is
  also why a more generic query tool would be equally safe; the choice of a few named tools is about how well an agent
  uses them, not security. I1 and I4 test it.
- **`since`** is the per-account `server_version` (the cursor the sync protocol already has), so "what changed since my
  last look" costs nothing new. The cursor is opaque to the client.
- **What an item exposes:** a Task's own fields only. `sourceEntryIds` are left out; a cited note may be unmarked
  (privacy default).
- **Item text is owner data, not instructions.** Each tool's description says so, because the agent reads it as context
  (prompt-injection hygiene for the receiving session).

### 4.1 "Triaged": storage and sync (stage C)

| | Storage | Device sees it | Cost |
|---|---|---|---|
| **T-a (Recommended)** | **New record kind `triage`**, id = the Task's id (as `entryState` uses its entry's id): `{ taskId, at, client, note }`. **Written by the Worker** through `pushRecords(db, userId, …)`: the same code path, version counter and isolation as a device push | Yes, through the normal pull: the marked row shows "Seen by Claude Code · 2 h ago". The owner can clear it (the device soft-deletes the row), and the item is untriaged again | Validator kind + Dexie table → **Dexie v8**, so **the rollback floor moves** to the first v8 build (RUNBOOK: fix forward past it) |
| T-b | Server-only table `agent_triage` | No | One D1 migration, no Dexie change. The owner can't see what the agent took in, and can't undo it from the phone |
| T-c | A `triagedAt` field on the Task | Yes | Two writers on one row: a device editing the Task from a stale base would overwrite the agent's mark, or the reverse. CAS keeps the text, but the race recurs |

`changedSinceTriage` = the Task's `updatedAt` > `triage.at`. It is computed, not stored, so an owner edit after triage
puts the item back in front of the agent with no extra write.

This is the first record a device didn't author. `origin`-style provenance: `client` names the agent (the OAuth client
name). The app labels it as an agent's mark, never as the owner's.

**Blast radius (T-a).** The Dexie v8 bump is the one-way door. A broken v8 upgrade blocks every device that opened it
until a fix ships, and the rollback floor can't help. The owner's phone sees it first. Known positive: the A6 stale-build
test, re-run with v8 data against a v7 build.

### 4.2 Write-back (stage D, later)

"Close the Task when the PR merges" is AI output changing a record, so under T5/A1 it is a **proposal**. A
`propose_close` tool writes a `taskProposal` with `op: 'close'`, which the owner confirms in the app. Today's rule "a close
names one task, **its note** and the evidence" needs an agent variant: no note, and the evidence is a URL plus a line. That
amendment is its own decision. **Re-entry:** stage C in use for two weeks and at least one closed-by-hand item that a
merged PR had already settled.

## 5. Isolation tests (written first, shown failing)

The `planner-mcp` suite uses the same `@cloudflare/vitest-plugin` harness as `api/test/` and seeds accounts the same way
(`account('a@example.com')`).

| # | Test | Negative control (must fail when…) |
|---|---|---|
| I1 | A and B each hold a marked Task **with the same id and project**. B's `list_items` returns only B's | the `user_id` filter is dropped from the read |
| I2 | B's `get_item(A's id)` → not found, the same answer as a random id | the handler looks up by id alone |
| I3 | B's `mark_triaged([A's id])` → `not_found`; A's `records` row count and `server_version` are unchanged | the triage write takes `userId` from the item, not the token |
| I4 | An **unmarked** Task of A's (and one with `project: null` whose text names the project) never appears in A's own `list_items` | the marked filter is removed |
| I5 | A's token after `disabled_at` is set, and after `DELETE /me` → 401 on the next call | the per-call D1 re-check is removed |
| I6 | MCP token at `planner-api /sync/pull` → 401; planner session token at `/mcp` → 401 | (two separate token stores; the test proves it) |
| I7 | MCP sign-in for an identity with an open invite but no account → refused, **0 rows** in `users`/`identities`/`invites` changes | admission calls the writing `admit()` |
| I8 | A stored `project` survives an older build's Task push (§2.2) | `'project'` removed from `ADDED_FIELDS.task` |

**Rows exercised / written** gets stated for each before "validated" (R2).

## 6. Vision impact

Today's Vision says what the planner is for the owner. This adds a second reader: the owner's coding agent. Proposed
addition to [PROJECT.md](PROJECT.md) §Vision (new paragraph, after the purpose line):

> A developer can mark what they capture as being about one of their projects and let their own coding agent read those
> marked items, and only those, through the planner's MCP endpoint. For that work the planner is also a context inbox for
> the agent: the owner writes when the thought comes, the agent picks it up when the session starts.

Relationship to H3 (PROJECT tiers, DECISION-TREE §3.8): H3 is a remote MCP endpoint "for the owner's account only, on
paste-friction evidence", with read/run/propose tools. This is a **narrower, earlier slice of H3 for every account**: it
reads marked items, triages them, and later proposes. Its evidence is a different one, the 2026-10-14 case. If D-119 is
accepted, the H3 row is amended to "H3-F (D-119) first; lens tools stay on their own evidence", and D-20 is settled as (a)
for this surface.

### 6.1 VOCABULARY rows (proposed; added in the same PR that accepts D-119)

| Term | Code name | Meaning | Not the same as | Status |
|---|---|---|---|---|
| **Project** | `Task.project` (slug) | A destination outside the planner that an item is about, set by the owner. Only items with a project are readable by an agent. One per item; null = personal | Theme (a personal goal with status, parked); Category; the planner's own `PROJECT.md` | H3-F |
| **Agent connection** | an OAuth grant (`OAUTH_KV`), listed with sessions | One coding agent the owner allowed to read their marked items: client name, scopes, revocable in Settings | a session (a device signed in to the app) | H3-F |
| **Triage** | `Triage`, table `triage`, record kind `triage` | An agent's mark that it has taken a marked item in: when, which client, an optional line. Written by the Worker, cleared by the owner | Task state (`done` stays the owner's) | H3-F stage C |

"Feedback" stays plain UI copy ("feedback about your app"), not a type. It names one use of a Project, not a concept.

## 7. Stages

| Stage | Ships | Depends on | Evidence |
|---|---|---|---|
| **S0** | Spike: `planner-mcp` on a throwaway route with one test account. CIMD sign-in from Claude Code with DCR disabled (if it fails, enable DCR with a registration rate limit; record which). KV free-plan limits read. `@modelcontextprotocol/server` and the OAuth library through the dependency audit, pinned exactly | D-119 accepted | A real `claude mcp add` + one tool call, logged in this doc |
| **A** | Marker: validator + chip + row action (§2) | none (app only; independent of MCP) | I8; DEVICE-CHECKS row on the phone |
| **A2** | Journal proposes projects (M-e): prompt list, `project` op, confirm on the row | A, with at least one marked Task | a run on the owner's account proposes a project for an unmarked dev Task and none for a personal one; the older-build pull read |
| **B** | `planner-mcp` read tools, consent, admission, `agent_calls`, Settings connections | S0, A | I1, I2, I4–I7 green with controls; owner reads his own items from a Claude Code session |
| **C** | `mark_triaged`, `triage` kind, Dexie v8 | B used for a week | I3; stale-build test with v8 |
| **D** | `propose_close` | §4.2 re-entry | — |

## 8. Sequencing against alpha

Current order (STATE, SLICE-ACCEPTANCE): **A2 tester notice → invites (the tester's invite expires 2026-10-24) →
restore-edit reconcile before the second invitee.** This design doesn't change that order. It doesn't touch the alpha
gate (A1–A7), and nothing here is a gate item.

**Re-entry (Recommended): S0 starts once restore-edit reconcile has merged and the tester has signed in**, i.e. after the
last item named before the second invitee. Before that, the only allowed work is accepting this design.

Stage A is small and app-only, so it could go earlier. It still changes Today, the surface the tester meets first. So it
waits for the same condition unless the owner moves it (§9 Q8).

Out of scope: per-project widgets, notes as items (M-b, §2.4), lens/run tools (H3 proper), the
Claude phone app as a client (same endpoint; untested).

## 9. Open questions (each with a recommendation)

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | What carries the marker | Task field · Entry tag · widget · boolean flag; set by the owner · by the Journal | **Task field `project` (M-a), set by the owner's chip or by confirming a Journal proposal in the run it already makes (M-e)**; Entry tag as M-b on its re-entry |
| Q2 | Marker value | project slug · boolean | **Slug**: one agent session per repo |
| Q3 | Where the endpoint runs | separate Worker `planner-mcp` · inside `planner-api` | **Separate Worker (E-a)**: no blast radius on sync during alpha; costs one GitHub OAuth App and one Google redirect URI, set up by the owner |
| Q4 | Authorization server | `@cloudflare/workers-oauth-provider` + KV · own AS in D1 (T3's "own OAuth code") | **The library.** The MCP auth spec changed this year (CIMD over DCR, resource binding). Tracking it by hand is the larger risk, and KV is a free-plan binding on the same account. Needs a T2 log line (a new primitive) |
| Q5 | Client registration | CIMD only · CIMD + DCR · pre-registered | **CIMD only**, DCR off: DCR is an unauthenticated KV write per call. Fall back to DCR with a rate limit only if S0 shows Claude Code can't use CIMD here |
| Q6 | Where "triaged" lives | synced `triage` kind · server-only table · Task field | **Synced kind (T-a)**: the owner sees and can undo what the agent took; accepts the Dexie v8 bump in stage C |
| Q7 | Who gets it | every account · owner first | **Built for every account, switched on for the owner's account first** (an allowlist row). Opened to invitees after a week of owner use and an updated tester notice line ("your coding agent can read items you mark") |
| Q8 | When | after restore-edit reconcile + tester signed in · stage A now · after alpha | **After reconcile + tester signed in (§8)**; stage A only earlier if the owner says so |
| Q9 | The word | Project · Feedback | **Project**: the marker names a destination; "feedback" is one use of it |
| Q10 | Can the MCP sign-in create an account or redeem an invite | yes · no | **No**: accounts are created only in the app's own sign-in (invite gate stays one door) |
| Q11 | Is the project hub (§10) the vision, with §2–§7 its first step | yes · keep this design to marked Tasks only | **Yes, staged as §10**: the first step is unchanged and the later ones reuse Report, executor and widget clones. The §6 Vision sentence then reads "…let their own coding agents read and report on each project…" |
| Q12 | Connection scope | per project (consent picks) · whole account | **Per project, with "all" as an explicit choice** (§3.3) |

## 10. Direction: the planner as a project hub (owner, 2026-10-14; proposed staging)

The owner's model, as stated: everything he captures is filed against the relevant active local projects. On contact, an
agent gets that project's share of all of it, on demand, not only its Tasks. Agents write back. The planner shows a
**widget per project** with that project's state: the last piece of work, how many sessions each piece took, a roadmap
summary. There is one such widget for each project the owner runs.

How it maps onto what exists (no new concepts beyond §6.1 except where named):

| Want | Existing piece | Change |
|---|---|---|
| All data portioned per project | `project` on Tasks (§2) | Extend to notes (M-b) and to the Journal's derived records (questions, answers) through their Task. The read filter stays the server's (§4, "only narrows"), with the connection's projects added |
| Agent writes back the project's state | **Report** (immutable AI output, A1/T5) and the `claude-code` **executor** VOCABULARY already names ("outside, over MCP, H3") | A `post_report` tool. The report has `executor: 'claude-code'`, it belongs to the project's widget, and its body is written by the agent. The validator adds the executor value; citations become optional for agent reports (they cite repo work, not notes) |
| Sessions per piece of work | none | A small record per agent session, `{ project, track, startedAt, endedAt, summary }`, posted by the agent (a Stop hook can call the tool). New kind → Dexie bump |
| A widget per project | **Widget** (one Dashboard, one account) | A new widget kind **`project`**, one instance per project, on the same Dashboard as Today. It shows the latest agent report plus counts from the session records. It holds no lens and runs no model, so it is not a D-111 clone (a clone carries a lens into the Journal). Each project is a part of the one planner's scope: it is not its own planner, account or Dashboard. Switched on from the Widgets page like any other widget |
| Two-way sync | MCP tools both ways | Not a file sync. Planner → agent: reads (§4). Agent → planner: reports, session records, close proposals (§4.2). Nothing the agent sends edits a Task or a note (A1) |

Two things to settle before anything here is built:

- **The word for a piece of work inside a project.** "Feature" is banned in this vocabulary (it collides with Lens and
  the model gate). Candidate: **Track**. To be decided with the VOCABULARY row.
- **What may leave a project.** A project widget copies an agent's summary into the backend (D1, server-readable, T6).
  For a project whose data must stay on its machine, the agent, which follows that project's own rules, decides what a
  report may say. The planner can't tell. A project whose rules forbid any summary leaving it gets no project widget.

**Staging:** §7's stages A–C stand as the first step (read marked Tasks). Then: **E** project-bound connections (above;
built with B, because it costs nothing extra there) · **F** `post_report` + project widget · **G** session records and
the per-track counts · **H** notes and Journal records per project. Each one waits for the last to be used for a week.
