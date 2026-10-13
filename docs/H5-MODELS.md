# H5 — Bring your own model (Design)

**Status: S0 draft, 2026-10-12.** D-78 … D-80, D-89 and D-90 are the owner's (2026-10-12). D-81 … D-88 are decided by Claude under
vibe-code; the owner may reverse any of them before S1 merges. §10 holds what is still open. **No S1 code until §10 is read.**
Terms per [VOCABULARY.md](VOCABULARY.md); invariants per [ARCHITECTURE.md](ARCHITECTURE.md); run shapes per
[HW-HARNESS.md](HW-HARNESS.md) §5 and §11.

## 1. Goal

The planner is a wrapper that runs declared actions (the harness, the Daily widget, later lenses and routines), checks
what comes back, stores it and tracks it over time. The model is replaceable. This tier lets each user **register the
model they want** (Claude, GPT, Gemini or any OpenAI-compatible endpoint) and runs the declared actions through it with no
copy and paste. Later (S3) the same actions run on a schedule with the app closed.

**What "register" means.** An API key, or an endpoint URL plus a key. A consumer subscription (Claude Pro/Max, ChatGPT
Plus) cannot be registered: since 2026-02-19 Anthropic's terms limit subscription OAuth to Claude Code and Claude.ai, and
since 2026-04-04 those tokens are blocked in third-party apps. The user pays their provider per token. Copy-paste stays
as the free executor `manual`.

**Acceptance (S2).** On the owner's phone, three days running: (a) a harness run with a registered model stores the same
records a paste run would, with no copy or paste; (b) a reply that is cut off or malformed stores nothing and the run
says why; (c) a Worker test shows the key is never returned to any client; (d) a Worker test shows a second account
cannot call the first account's model (negative control).
**Acceptance (S3).** Daily arrives on a day the app was not opened before it ran.

## 2. Decisions

| # | Decision | Supersedes |
|---|---|---|
| D-78 | **Owner, 2026-10-12: bring your own model is the core AI path.** A user registers a model; the planner's declared runs execute through it. Each user pays their own provider | D-21 (owner key, owner-only AI) → its option (b), per-user keys. D-63 (copy-prompt as *the* executor) → copy-prompt stays as executor `manual`. D-42 (H5 only when widgets go stale) → H5 is next on the path. D-37 (H3 on paste-friction evidence) stands, but H3 is off the critical path and optional |
| D-79 | **Owner, same: the key is kept on the Worker, encrypted at rest, and is write-only.** It enables runs with the app closed (S3), keeps the CSP as it is, and allows custom endpoints | — |
| D-80 | **Owner, same (an assumption he accepted with D-79): the owner's account first.** Invitees get model registration after S2 acceptance, once the tester notice says where a run sends notes (§7) | — |
| D-81 | **Claude: two request formats, no SDKs.** `openai-chat` (OpenAI-compatible chat completions: OpenAI, OpenRouter, Gemini's compatibility endpoint, Mistral, Groq, and any custom base URL) and `anthropic-messages`. Plain `fetch` in the Worker, matching the S1 choice of own code over libraries (bundle size, CPU) | — |
| D-82 | **Claude: the device composes and checks; the Worker only calls the model.** An on-demand run sends the composed prompt; the reply comes back to the same `check` and `store` a paste goes through (`RunStep.vue`). No new parser, no Worker-side apply until S3 | — |
| D-83 | **Claude: a paid reply is never lost.** *(Amended 2026-10-12 by D-91: the call runs as a Workflow instance; the device fetches the reply by call id.)* The Worker writes the reply to the call row before it answers. A client that dropped the connection (the phone killed the app) fetches it by call id; the run's `waiting` state, which already exists for a late paste, covers it | — |
| D-84 | **Claude: the key is bound to its endpoint.** Changing a model's format or base URL clears its key; the user enters it again. The base URL is inside the encryption's associated data, so a stored key cannot be decrypted for any other host. Why: a stolen session token must not be able to redirect a stored key to the attacker's server | — |
| D-85 | **Claude: a cut-off reply is refused before parsing.** `finish_reason: "length"` (openai-chat) or `stop_reason: "max_tokens"` (anthropic-messages) marks the call `cut_off`; nothing is parsed or stored. This lands with the cut-off parser tests (workspace `docs/architecture/06`, A7), which come due with the first API-driven run | — |
| D-86 | **Claude: code decides when a model runs, and a cap bounds it.** A Worker rate limit on the call route plus a daily call cap per user (default in §10 O3). It protects the user's own money from a client loop or a stolen session. The model never schedules itself (06 L8) | — |
| D-87 | **Claude: the call row is the audit for model calls (A5).** It holds who, which model, which stage and run, how many notes, prompt bytes, the provider's token counts, the outcome and the duration. **No prompt text is stored.** The reply text is kept until the device stores the run or 7 days pass, then cleared | — |
| D-88 | **Claude: provider error bodies are never passed through or logged.** They are mapped to a category (`key_rejected`, `rate_limited`, `model_not_found`, `model_unavailable` (D-92), `provider_down`, `bad_request`). Some providers echo part of the key in an error message | — |
| D-89 | **Owner, 2026-10-12 (O1): the word is Routine** — a declared run (harness, a widget's run, a lens) bound to a time. `Routine`, table `routines`; ARCHITECTURE A8's scheduler registry is `ROUTINES` | VOCABULARY's 2026-10-09 rejection of *Routine* as a name for Lens |
| D-90 | **Owner, same (O6): D-22 (list own sessions, sign out everywhere) is built before any invitee can register a model** | D-22's re-entry "invitee #4" |
| D-94 | **Claude (S1, 2026-10-12): the prompt sits in the call row only while the call runs**, cleared in the same write that records the outcome; the Workflow instance carries ids only (`userId`, `callId`), because Workflow state is kept up to 3 days on the free plan. Instance retention is set to 1 day (success) / 3 days (error) | Refines D-87 |
| D-95 | **Claude (S1): three outcomes besides the provider's.** `refused` (Anthropic `stop_reason: refusal`, OpenAI `finish_reason: content_filter`) keeps no text; `no_key` (no key, a deleted model, or a key that no longer opens for this endpoint) makes no provider call; `lost` (pending past the step's 15-minute timeout) | Extends D-88 |
| D-96 | **Claude (S1): the cap is 30 calls per rolling 24 h per user plus 10 per minute** (`AI_DAILY_CAP`, `RL_AI_USER`); a test call counts. A per-user setting arrives with S2's Models page | Settles §10 O3 for S1 |
| D-97 | **Claude (S1), a deviation from D-93, named:** S1 has no client, so nothing can drive the Test route with a session before S1 merges. The first real `anthropic-messages` call moves to S2's Models page **Test** button, before S2 ships to daily use | D-93's gate |
| D-98 | **Claude (S1, after CodeReview): five guards.** (1) **At most one provider call per row**: a step claims the call (`pending` → `calling`, conditional) before calling, so a replayed step calls nobody — a step that dies mid-call costs a lost reply, never a second bill. (2) **Sweep on every touch** (start, read, export): replies past 7 days cleared, an unclaimed call past 30 min or a claimed one past 16 min becomes `lost` with its prompt cleared; a throw inside the step clears the prompt too. (3) **Stop reasons are an allowlist**: only `stop` (openai-chat) and `end_turn`/`stop_sequence` (anthropic-messages) keep text; any other spelling, or none, is `cut_off`. (4) **Redirects are never followed**: a 3xx is `bad_request`, so the key cannot ride a redirect to another host. (5) **The daily cap and the 10-model limit are checked inside the insert** (one statement), so parallel requests cannot all pass a count read | D-83, D-85, D-87, D-94 |
| D-99 | **Claude (S2, 2026-10-12, after CodeReview):** the model choice is **per device** and carries a warning to update every device first — the O5 guard. Waiting on a call holds no lock: Stop waiting and Copy instead stay available, the reply box is read-only meanwhile, a poll rides out up to 6 failed reads in a row and trusts the Worker's own `lost`. A run's panel opens on arrival unless a model call for that run already ended without a reply. Gemini answers a bad key with HTTP 400, so `bad_request` names a wrong key first | D-92 wording, calibration 1b's open-on-arrival rule |

## 3. What exists — the seam

```
compose (domain, device)          executor (only this step changes)        check + store (domain, device)
composeHarness2() ── prompt ──▶   manual: copy → user pastes reply    ──▶   parseHarnessOutput2() → applyHarness2()
composeJournal()                  model:  POST /ai/calls → reply          validateReport()      → records → outbox
```

- `src/harness/RunStep.vue` already takes `compose`, `check` and `store` as props; the executor is the copy-and-paste step
  between them. A `model` executor is a second way to fill the reply box.
- Both parsers refuse anything that is not one JSON object, and never repair it (06 L5). This is what lets an untested model
  fail safely: a reply in the wrong shape stores nothing.
- The run record says `executor: 'copy-prompt'` and the shared validator (`src/domain/records.ts`, used by both device and
  Worker) accepts only that value. Adding `model` is a change to a synced record: see §5 and §10 O5.

## 4. Flow — an on-demand run (S1 + S2)

```
device                                   Worker                                    provider
compose prompt (as today)
POST /ai/calls {modelId, stage, runId,
  prompt, entryCount} ─────────────────▶ session → user_id (A11)
                                         cap + rate limit (D-86)
                                         row ai_calls: pending
                                         decrypt key (AAD = user, model, base URL)
                                         ── request ─────────────────────────────▶ chat completions / messages
                                         ◀── reply + usage + stop reason ─────────
                                         cut off? → status cut_off, no reply kept
                                         row: ok + reply text + token counts
◀── {callId, status, reply} ──────────── 
check(reply) → preview → store            
PATCH /ai/calls/:id {stored: true} ────▶ reply text cleared
```

**Since the spike (D-91):** `POST /ai/calls` does not wait for the provider. It writes the `pending` row, starts a Workflow
instance that makes the call and writes the reply, and answers at once with the call id; the device polls
`GET /ai/calls/:id`. The diagram's middle column runs inside that Workflow step. A closed app loses nothing: on the next
open the run is `waiting` and the device continues from `check`. Measured in [H5-S1-SPIKE.md](H5-S1-SPIKE.md): a
harness-sized call takes 10–58 s; a request handler dies with its client and `waitUntil` lasts ~30 s after it.

## 5. Data

**D1 `0009`** — both tables per account, both in `ACCOUNT_TABLES` (A13; `test/account.test.ts` fails if either is missing).

| Table | Columns | Notes |
|---|---|---|
| `models` | `user_id`, `id`, `label`, `format` (`openai-chat` · `anthropic-messages`), `base_url`, `model` (provider's model id, typed by the user), `max_tokens`, `key_ct`, `key_iv`, `key_hint` (last 4 characters), `key_version`, `created_at`, `updated_at` | Export leaves out `key_ct` and `key_iv`. Not synced through `records`: the device never holds the key, so the device cannot be the writer |
| `ai_calls` | `user_id`, `id`, `model_id`, `stage`, `run_id`, `entry_count`, `prompt_bytes`, `status` (`pending` · `ok` · `cut_off` · one of the D-88 categories), `tokens_in`, `tokens_out`, `started_at`, `finished_at`, `reply`, `reply_cleared_at` | `reply` holds model output derived from the user's notes: it is per-account data, exported and deleted with the account |

**Device.** No new Dexie table. The model list (without key fields) is fetched online for Settings and the run picker
and cached in `settings`; a setting holds the default model. Without a registered model, or offline, Run falls back to `manual`.

**Run record.** `executor` gains `model`; the run gains optional `modelId` and `callId`. Both new keys may be absent and are
stored absent (D-77's rule). **Rollout order:** a client and a Worker that accept `executor: 'model'` are deployed before
any `model` run is written (§10 O5).

## 6. Worker routes

| Route | Does | Guard |
|---|---|---|
| `GET /me/models` | List the user's models, never key fields | session |
| `PUT /me/models/:id` | Create or edit label, format, base URL, model id, max tokens; `key` optional. A format or base URL change without a new key clears the key (D-84) | session; base URL is `https:`, no user info, hostname not an IP literal and not `localhost` |
| `DELETE /me/models/:id` | Remove the model and its key | session |
| `POST /me/models/:id/test` | A minimal call (a few tokens) to prove key, endpoint and model id; returns ok or a D-88 category | session; counts toward the cap |
| `POST /ai/calls` | Start a model call on a prompt the device composed: writes the row, starts the Workflow, answers with the call id (§4, D-91) | session · rate limit · daily cap · prompt size ceiling |
| `GET /ai/calls/:id`, `PATCH /ai/calls/:id` | Fetch a reply after a drop; mark it stored (clears the text) | session; own rows only |

**Secret.** `MODEL_KEY_SECRET` (32 random bytes, base64) — a new Worker secret the owner creates in a secrets file and loads with
`wrangler secret bulk`, as for the OAuth secrets. AES-GCM 256, a random 12-byte IV per row, associated data
`user_id | model id | base_url`. `key_version` allows rotation without a flag day.

## 7. Security and privacy

- **Where notes go.** A run sends its slice to the provider the user chose; the paste step, where the user sent it
  themselves, is gone. Registration plus the Run tap is the consent; the Run panel names the provider and the note count
  before the call, as it names the note count today. The Worker already reads entries (B5, ARCHITECTURE §7), so routing
  the prompt through it adds no new reader.
- **Invitees (D-80).** Before an invitee can register a model, the tester notice (D-52 pattern) says which provider receives
  their notes and that they pay it. Wording is drafted by Claude and approved and sent by the owner.
- **Stolen session token.** It can spend the user's key, up to the cap (D-86), but cannot read the key or point it at
  another host (D-84). Sign-out everywhere (D-22) becomes more valuable here: §10 O6.
- **Leaked master secret plus a D1 dump** exposes every stored key. Mitigations: the secret lives only in the Worker
  environment, never in the repo or D1; `key_version` allows rotation; every provider lets a user revoke a key in one step.
- **The CSP does not change**: the device talks only to the Worker.
- **Public repo:** tests use fake keys and a mocked `fetch`; no real provider call runs in CI.

## 8. Blast radius — where each slice reaches

| Area | S1 | S2 | S3 |
|---|---|---|---|
| `src/domain/` composers and parsers | — | none: reused as they are | Worker imports them (they are pure) |
| `src/domain/records.ts` (shared validator) | `executor: 'model'`, optional `modelId`, `callId` | — | — |
| Worker `api/src/` | new `models.ts`, `aiCalls.ts`, provider adapters, crypto; routes in `index.ts` | — | cron handler, Worker-side compose and apply |
| D1 | `0009` | — | schedule rows (A11 amendment D-44) |
| `wrangler.toml` | new rate limit binding; new secret; `[[workflows]]` binding (D-91) | — | `[triggers] crons` |
| Device | — | Settings → Models; executor switch in `RunStep.vue`; run picker | notification permission (D-16) |
| `public/_headers` CSP | none | none | Web Push endpoints only if D-16 is built |
| Tester notice | — | updated before invitees (D-80) | — |

**What breaks if S1 is wrong:** only model runs. The paste path stays untouched in every slice, so a bad deploy can be
undone by turning the executor switch back to `manual`.

## 9. Slices of work

| Slice | Content | Known positive first |
|---|---|---|
| **S1 step 0 — spike** ✅ closed 2026-10-12 ([H5-S1-SPIKE.md](H5-S1-SPIKE.md); D-91 … D-93) | From the deployed Worker: one call per format against a real provider with the owner's key; **a 60-second provider call with the client disconnected after 2 s** (does `ctx.waitUntil` keep it alive?); CPU per call; free-plan cron limits for S3 | the disconnected call either lands in D1 or the fallback is chosen with evidence (Durable Object, or keep the connection open and accept the loss) |
| **S1 Worker** ✅ built 2026-10-12 | `0009`; models CRUD with encrypted key; `/ai/calls` as a Workflow (D-91) with both adapters, D-85 cut-off handling, D-88/D-92/D-95 outcomes, cap (D-96); A13 coverage; validator accepts `model` (run gains `modelId`, `callId`) | key-never-returned test; second-account negative control; cut-off reply → `cut_off` and no reply kept; endpoint change clears key; a provider error echoing a fake key never appears in a response or log |
| **S1 parser tests** ✅ | 06 A7: a reply cut off mid-string is refused by both parsers, nothing stored | the cut-off fixture fails before the test is trusted |
| **S2 client** ✅ built 2026-10-12 | Settings → AI models (add, test, remove; "This device runs with", per device); Run with … on the run panel (Copy instead stays); a waiting call picked up after a reload; the run records `executor: 'model'` with its ids; DEVICE-CHECKS 33–36 | a run with a wrong key shows `key_rejected` and stores nothing |
| **S3 routines** | Own design addendum at its S0: Worker-side compose and apply over `records`, cron, schedule rows (D-44), a global pause (A8), notification (D-16) | — |
| H3 (optional) | Remote MCP for Claude clients, unchanged from D-20 and D-37 | — |

## 10. Open points

| # | Point | Recommendation | Who |
|---|---|---|---|
| O1 ✅ D-89 | **The word for a declared run on a schedule.** The owner says "routine". VOCABULARY rejected *Routine* as a name for Lens because it "implies a schedule", which is exactly this concept; ARCHITECTURE A8 says `SCHEDULES` in code | **Routine** for the concept, in UI and code (`Routine`, table `routines`); A8's `SCHEDULES` renamed with it. **Owner, 2026-10-12: Routine** | — |
| O2 | Which presets the Models page offers | Anthropic, OpenAI, Google Gemini (compatibility endpoint), OpenRouter, plus "Custom (OpenAI-compatible)". A preset fills format and base URL; the user types the model id | Claude |
| O3 | Default daily call cap | 30 calls per user per day, changeable in Settings. A full day is about 3–6 calls (harness, Daily, a few re-runs) | Claude |
| O4 ✅ D-91 | Whether a provider call survives a client disconnect | Measured: only inside a Workflow. Every model call runs as one | — |
| O5 ✅ | What a device running an older build does when it pulls a run with `executor: 'model'` | **Read in S1:** it drops the row with a console warning and moves its cursor past it, so that device never gets the run (`src/sync/engine.ts`, pull). The same holds for a journal **report** a model wrote (`executor: 'model'` on the report too). Guard in S2: a device runs with a model only after the owner chooses one there, and the choice carries a warning to update every device first (DEVICE-CHECKS 36). So S2's accepting client reaches every device before the first model run is written; S1's Worker accepts `model` already | — |
| O6 ✅ D-90 | Pull D-22 (list sessions, sign out everywhere) forward from "invitee #4" | **Owner, 2026-10-12: yes**, built before any invitee can register a model (D-80): a stored key raises what a stolen session is worth | — |
| O7 | Prompts were tuned on Claude; other models may miss the JSON shape | Measure, don't pre-tune: `ai_calls` outcome per model gives the refusal rate. If refusals appear, 06 A5 (accept exactly one `{…}` span) is the first lever | Claude |
| O8 | A token estimate before Run | Show the estimated input tokens (prompt bytes / 4), no price: prices differ per model and the app keeps no price table | Claude |
