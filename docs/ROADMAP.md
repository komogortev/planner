# Planner roadmap (2026-11-22)

**Status: proposed (owner review).** It orders what is open across [STATE.md](STATE.md),
[ALPHA-TEST-PLAN.md](ALPHA-TEST-PLAN.md) (D-122) and [INBOX.md](INBOX.md), with the owner's priorities from
2026-11-22. STATE stays the snapshot; this file is the order. Ids in parentheses are INBOX lines.

## How to read the marks

| Mark | Meaning | Owner's part |
|---|---|---|
| **AUTO** | Claude designs, builds, tests and merges on green (vibe-code mode, 2026-10-10) | Validate the result: the named check, usually on the phone after the deploy |
| **AUTO + DEPLOY** | As AUTO, but the change reaches prod only through a deploy, and prod deploys are the owner's | Run the guarded deploy (`pnpm --dir api run deploy`, then Pages), then validate |
| **OWNER** | Only the owner can do it: a phone check, a secret, a Cloudflare or GitHub account setting, a decision, anything sent to people | The step itself; Claude prepares it and checks the result afterwards |
| **DECIDE** | A design ends in a question; nothing gets built before the answer | One answer; Claude proceeds under the recommendation only where the doc says so |

## Phase 1: finish what is in flight (alpha track, D-122)

| # | Item | Mark | Owner validates |
|---|---|---|---|
| 1.1 | Deploy the Worker: #195 (R6 cause 1) is merged but prod still runs `6183100` | OWNER | `pnpm smoke` green |
| 1.2 | Check which token expired (fff27f59); renew in Settings → Integrations if it is the bridge token | OWNER | A project card loads |
| 1.3 | Morning schedule: phone check of Settings → Schedules, then flip `SCHEDULES_PAUSED` for the owner's account first, with `wrangler tail` running | OWNER (Claude reads the tail) | A Morning run arrives on a day the app wasn't opened |
| 1.4 | A12 tests (pause stops a run, a waiting reply skips the tick, no account runs on another's key), then raise the test floor | AUTO | CI green; nothing to check on the phone |
| 1.5 | R8 G5: owner adds the Claude workflow and `CLAUDE_CODE_OAUTH_TOKEN` to one repo; Claude runs issue → Action → PR → merge and fixes what breaks | OWNER, then AUTO | The card shows the merged PR |
| 1.6 | R9 phone checks: DEVICE-CHECKS 37–41 and each deploy above | OWNER | — |
| 1.7 | R10 gate: Claude drafts the tester notice (scheduled runs, GitHub token, export scope) and re-checks the facts table against the code | AUTO draft, OWNER sends | The notice reads true |

## Phase 2: input types (HIGH, fe9a6102)

| # | Item | Mark | Owner validates |
|---|---|---|---|
| 2.0 | Design doc: which types (pictures, long multi-line text; the owner names any others), storage (D1 rows vs Cloudflare R2), sync, export, what reaches the model, size caps | DECIDE | Answers the doc's questions |
| 2.1 | Long multi-line text (b41e07d2): every reader and writer of the 200-character limit, a new cap, multi-line input | AUTO + DEPLOY | Paste a multi-line brief on the phone; it survives sync to a second device |
| 2.2 | Pictures in a note: paste, pick or shoot; stored, synced, shown, exported. **Use case (owner 2026-11-25): phone photo capture** of receipts, papers and notices, processed into notes that Claude sessions read. **On the roadmap, not scheduled** (open questions below) | DECIDE first, then AUTO + DEPLOY; OWNER turns on R2 if the design picks it (a Cloudflare account setting) | Shoot a receipt on the phone; the next local export carries it as a note a session can route |
| 2.3 | Further types the design names | AUTO + DEPLOY, one slice each | Per slice |

**Sequencing: answered (owner 2026-11-22, D-142): Phase 2 starts now, alongside Phase 1.** Design: [INPUT-TYPES.md](INPUT-TYPES.md).

**2.2 phone photo capture (owner 2026-11-25, fe9a6102).** Today a receipt travels photo → Messenger to himself → PC →
pasted into a Claude session. Wanted: shoot it in the planner, where it accumulates, and have it come out as a note that
`api/scripts/export-local.mjs` and the `notes-intake` skill pick up. Owner: "we won't solve it today", so no slice is
scheduled. Open design questions (they extend [INPUT-TYPES.md](INPUT-TYPES.md) §7):

- **Storage:** D1 rows vs Cloudflare R2 on the free plan (a 64 KB record cap and D1 row size rule out storing the image
  in a record; R2 is an owner account setting), size cap and on-phone downscale, offline capture in Dexie, and the CSP
  (`img-src` has no `blob:` today; `_headers` is applied only on deployed builds).
- **Who reads the photo:** the per-device H5 model, if it has vision, or a step in the Claude session; and whether the
  image is kept at all or only its extracted text (§7 Q1).
- **How it reaches its home:** a note `kind` (receipt, document, other) so notes-intake routes a receipt to Finances and
  a household paper to `Household/docs/INBOX.md`.
- **Privacy:** receipts carry amounts and merchant names. The export, the GitHub bridge (Send as issue) and any model
  call must never carry them anywhere public; figures stay in Finances.

## Phase 3: Claude reads the planner from anywhere (5c0a1121, 7c143096)

| # | Item | Mark | Owner validates |
|---|---|---|---|
| — | Done: desktop sessions pull a fresh read-only copy on their own (#205, #209: `export-local.mjs --max-age-hours`) | — | — |
| 3.0 | Refresh the MCP design ([MCP-FEEDBACK.md](MCP-FEEDBACK.md), D-119) for a remote read-only endpoint on the Worker with OAuth, so the Claude phone app can add it as a connector | DECIDE | Answers the doc's questions |
| 3.1 | Read tools: notes, tasks, recall (no model call) | AUTO + DEPLOY | Add the connector in the Claude app; ask "what's open today" from the phone |
| 3.2 | Write tools later (append a note, add a task), proposal-only for anything that changes owner text (06 A4: tool allowlist per context) | DECIDE, then AUTO + DEPLOY | — |

After 3.1, in-app chat stays parked (fb579731). Auditing stays in Claude sessions (owner 2026-11-22, 30f106e2).

## Phase 4: memory lives in awoth (7a02705d, owner 2026-11-22)

| # | Item | Mark | Owner validates |
|---|---|---|---|
| 4.0 | **Vault side, not this repo:** compartments in the awoth vault that a session can load fast: a small always-read core, per-domain notes read on demand, and an index naming which compartment answers which question | DECIDE (a design in the vault, owner-model work) | The layout matches how he thinks of the domains |
| 4.1 | Planner side: one profile text in Settings, turned on by the owner, that the planner's own model runs read. Written by the owner, or pasted from the vault's profile | AUTO + DEPLOY | The next Journal run uses it; turning it off removes it from the prompt |

## Phase 5: smaller items, any order

| # | Item | Mark | Owner validates |
|---|---|---|---|
| 5.1 | Day summary (9e669392): the `day-summary` skill reads the "done today" note from the local pull. Its re-entry (R6 export) is now met another way. The change is in the skill, outside this repo | AUTO | Run `day summary` with no typed text |
| 5.2 | Evening coverage (541ae15e): covered. The Summary card's "Write the evening brief" is the run started by hand (R3 #173); the owner closes the line | — | Turn on Summary on the Widgets page, tap it in the evening |
| 5.3 | "Where your data goes" page (850dc28d), written alongside the R10 notice | AUTO + DEPLOY | It matches the notice |
| 5.4 | "Window" kind (cb86a0d7) | DECIDE first | — |
| 5.5 | Spend cap and model size per AI feature (53d833a9); re-entry: a second scheduled feature | AUTO + DEPLOY | — |
| 5.6 | Prompt guards from 06 §4: A2 order test, A7 cut-off tests | AUTO | CI green |

## Parked (each with its re-entry)

Notifications bc72ef5e (after R10, D-127) · R6 nightly export (an off-Cloudflare backup wanted) · calendar 5464c38f
(the owner asks for a proper integration) · in-app chat fb579731 (MCP access doesn't cover the need) · in-app AI audit
30f106e2 (sessions stop being enough).

## 5. Answered

**Q1 (D-142, owner 2026-11-22):** start Phase 2 now, alongside Phase 1, and fold it into the R10 notice.
