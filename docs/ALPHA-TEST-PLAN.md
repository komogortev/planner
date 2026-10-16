# Alpha test plan — full scope (2026-10-16)

**Status: accepted (owner, 2026-10-16) with the recommended answers to Q1–Q4 and Q6 (D-122); Q5 open. R1 ✅ 2026-10-16 (A8, #169). R2 drafted: [H5-S3-ROUTINES.md](H5-S3-ROUTINES.md), decisions D-123…D-130 with the owner.** Owner, 2026-10-16: alpha starts only when every roadmap item up to and including
H5 S3 has landed, plus UI calibrations found along the way. This **supersedes D-114** ("the declared slice is enough to
open alpha"). The change is D-122 in [DECISION-TREE.md](DECISION-TREE.md). [SLICE-ACCEPTANCE.md](SLICE-ACCEPTANCE.md) stays the one gate: §1 gains rows A8–A13 (§3 below). Terms per
[VOCABULARY.md](VOCABULARY.md).

**Consequence for the calendar.** The first tester's invite expires **2026-10-24**. H5 S3 alone has no design yet (its own
S0, [H5-MODELS.md](H5-MODELS.md)), and push notifications do not exist in the app. So the gate will not pass by then. The
invite is re-issued when the gate passes (`node api/scripts/invite.mjs create <email> --remote`). Letting it lapse costs
nothing.

## 1. What testers test (the tester script)

Each tester gets this list with the notice. A row is a feature, what to try, and what should happen. "Report" means a
note in the app, or the contact line in the notice. **Proof** says what holds the row before a tester sees it: an
automated test, a DEVICE-CHECKS row the owner ran on the phone, or **gap**: not built or not verified yet (§2).

### 1.1 Getting in

| # | Feature | Try | Should happen | Proof |
|---|---|---|---|---|
| T1 | Sign in | Open the link, sign in with Google (Gmail) or GitHub | Lands on the Dashboard; no second sign-in on the same device | H1-S2 sign-in; iPhone/iPad: H1-S1-SPIKE step C re-opens first |
| T2 | Install | Install the app (Android: Install in Settings; desktop: the browser's install) | Opens as its own window, signed in | DEVICE-CHECKS (install) |
| T3 | Updates | Settings → App info → Check for updates | Says up to date, or fetches and asks to reopen | #118; A6 stale-build screen (`staleBuild.test.ts`) |
| T4 | Layout | Swipe the pages; tap the dots; More; More → Switch to the top bar and back | The current dot lights; the choice survives a reopen | DEVICE-CHECKS 39–40 — **gap: not run on a phone** |

### 1.2 Capture and sync (works without AI)

| # | Feature | Try | Should happen | Proof |
|---|---|---|---|---|
| T5 | Capture | Home: write a note, save | Shows in Notes on the Dashboard, "N today" counts it | C1 `engine.test.ts` |
| T6 | Two devices | Same account on phone and desktop; write on one | It appears on the other within about a minute | C1; owner §2 week |
| T7 | Offline | Airplane mode, write a note, close and reopen the app, reconnect | Marked unsynced until back online, then syncs once | C2 `engine.test.ts`, `group.test.ts` |
| T8 | Remove and restore | Notes: ✕ a note, open "Removed", restore it | Leaves and comes back with its count | DEVICE-CHECKS 32 |

### 1.3 The Journal loop (needs your own AI key)

| # | Feature | Try | Should happen | Proof |
|---|---|---|---|---|
| T9 | Add a model | Settings → AI models → Add (Gemini: "How do I get a free key?") → Save → Test | Key shows only as its last 4 characters; Test says "Works" | L7; DEVICE-CHECKS 33, 41 — **41 gap** |
| T10 | Get feedback | Write 2–3 notes, tap Get feedback on the strip | A run, then questions about your notes; no copy or paste anywhere | L1, L2; **gap: D-113 removal (paste code still shipped, hidden behind "no model")** |
| T11 | Answer | Answer a question; run again | The next run does not re-ask it and uses the answer | L2 `loop.test.ts` |
| T12 | Proposals | A "Done? A note says…" proposal: read the buttons, try Correct… | Buttons name the outcome; Correct… is read by the next run | DEVICE-CHECKS 37 — **gap: not run on a phone** |
| T13 | Today | Tasks from your notes show on Today; mark one done, push one to tomorrow | Done is gone tomorrow; pushed shows tomorrow; untouched stays, marked overdue | L3, L4 |
| T14 | Closed mid-run | Start a run, close the app, reopen a minute later | The answer is there, no second run | DEVICE-CHECKS 35; L6 |
| T15 | Summary | Open Summary at the end of a day | What got done, what moved to tomorrow, what is still open, what was dropped | **gap: Summary v3 not built; today hidden from testers (G2, #146)** |
| T16 | Runs without opening the app | Leave the app closed overnight with a model set | Today is ready in the morning (and a notification, if on); a pause switch stops it | **gap: H5 S3 not designed or built** |

### 1.4 Projects (optional, needs a GitHub token)

| # | Feature | Try | Should happen | Proof |
|---|---|---|---|---|
| T17 | Connect GitHub | Settings → Integrations → paste a fine-grained token | Shows connected and the token's expiry; the token is never shown again | G1 tests; owner verified 10-16 |
| T18 | Project cards | Switch a repo on; open the Dashboard | A folded card with the repo's STATE snapshot and recent merges; ⋯ → tint | G2, C1, C4; owner verified C4 — **folded card (#158) not run on a phone** |
| T19 | Send an issue | Card → New issue → send | One issue in the repo, label `planner`, signed "Sent from koplanner"; listed on the card | C2; owner's real Send 10-16 |
| T20 | Claude loop | On a repo with the Claude Action: Ask Claude to work on it | The card shows Claude's last line, then the PR it links; after you merge, the card updates | **gap: G5 end to end never run (no repo has the workflow)** |

### 1.5 Your account

| # | Feature | Try | Should happen | Proof |
|---|---|---|---|---|
| T21 | Signed-in devices | Settings → Signed-in devices; sign out the other device | Both listed, this one first; the other shows "sign in again" on its next sync | A1 `sessions.test.ts`; DEVICE-CHECKS 38 — **gap: not run on a phone** |
| T22 | Export | Settings → Your data → Export | A file with every note and record you wrote | A3 |
| T23 | Delete account | Last, on purpose: Settings → Your data → Delete | Signed out everywhere; signing in again finds nothing | A3 `account.test.ts` |

**Testers are not asked to test:** isolation between accounts (A4), the stale-build screen (A6), restore recovery (A7 and
§2 R1), the nightly export. These are owner-run, held by tests and drills, and invisible when they work.

## 2. The gap — what lands before any tester-related task starts

Ordered by dependency, then by blast radius (what breaks, for whom, if it goes wrong). "Owner" rows are observed on the
phone or need a secret or a call only the owner can make; Claude does the rest.

| # | Item | Roadmap | Size | Blast radius if wrong | Who | Depends on |
|---|---|---|---|---|---|---|
| R1 | **Restore-edit reconcile.** The D-58 sweep re-uploads rows the server lost, but a row the server still has at an *older* version overwrites the device's newer acknowledged edit (a done Task, an answer) (mechanism inferred from RUNBOOK §restore; confirmed by the test first). Proposed fix: in the sweep, a local row whose acknowledged version the server no longer has goes back into the outbox as an edit on the server's version, not the other way round. Test: restore below an acknowledged edit, edit survives on every device | 3 | M | **Sync engine + D1, every account.** Wrong = edits lost or duplicated for everyone | Claude | — |
| R2 | **H5 S3 S0 design addendum** (docs only): Worker-side compose and apply over `records` (D-82 kept for on-demand runs), cron, schedule rows (D-44), global pause (A8 in H5), notification (D-16: web push needs VAPID keys, a subscription table, a D1 migration). Ends in owner decisions | 8 | S | None (docs) | Claude → owner | — |
| R3 | **Summary v3**: a lens over today's Tasks (done today · pushed · still open · dropped) and their notes, evening-brief style (D-109). Then Summary is listed for every account (lifts #146) | 6 | M | Harness: a model run per account. Wrong = a misleading summary; no data written beyond the run | Claude | — |
| R4 | **D-113 removal**: the paste run path, `harness/clipboard.ts`, the paste-waiting state, Copy buttons and paste copy, the v1 `loop.ts` / `journal.ts` once R3 replaces them; the test floor is lowered explicitly in the same PR | 7 | S–M | Client, every account running a model. Wrong = a device with "paste" saved has no run path; a missed reference fails typecheck | Claude | R3 |
| R5 | **UI calibrations** from the gap register: G8 Get feedback opens on the first question's input; G10 a run-through button only when changes wait; G11 auto-growing add-task box; G13 Widgets page styled like live widgets; G7 the "Journal" name (owner's call); G9 free-form input on an empty queue (**harness**: where the reply lands) | 7+ | S each | Client only, except G9 (harness) | Claude; G7, G9 owner call | R4 (same files) |
| R6 | **Nightly export**: Worker cron writes the export to the private data repo (ARCHITECTURE §4, H1-ENTRIES §9) | 4 | S–M | Worker cron + a private repo. Wrong scope = a tester's notes in the owner's GitHub (a notice claim) | Claude; owner sets the repo token secret | — |
| R7 | **H5 S3 build**, 2–3 PRs per R2: Worker compose/apply + cron + pause; then notification | 8 | L | **Worker, stored model keys, provider cost, runs with nobody watching.** The widest radius on the list | Claude | R2 decisions, R3 (the lens it runs) |
| R8 | **G5 end to end**: the Claude workflow and a `CLAUDE_CODE_OAUTH_TOKEN` secret on one repo; one real issue → Action → PR → merge → card shows it; fixes from that run | 5 | S | The chosen repo and its Actions. The planner never writes workflows | Owner adds workflow + secret; Claude verifies and fixes | — |
| R9 | **Phone checks** (owner): DEVICE-CHECKS 37–41, #148 menu tap, D-105 on a real model, folded card and loop back (#158–#164), then each slice above after its deploy | 2 | — | Owner's devices only | Owner | each deploy |
| R10 | **Gate and notice**: SLICE-ACCEPTANCE §1 rows A8–A13; D-122; the notice rewritten for scheduled runs (notes sent with the app closed), the GitHub token, the export scope; facts table re-checked against the code; invite re-issued | 1 | S | Outward-facing: what testers are told. Owner sends | Claude drafts; owner sends | R1–R9 |

### Open decisions (proceeding under the recommendation unless the owner says otherwise)

| # | Question | Recommended | Alternative |
|---|---|---|---|
| Q1 | Nightly export scope | **Owner's account only** (Recommended): no tester notes leave Cloudflare; the notice keeps "export + Time Travel" as tester backup | Every account: tester notes in the owner's private repo; the notice must say so |
| Q2 | H5 S3 for alpha: notifications in or out | **In** (Recommended), as the last S3 PR: "full scope" was the owner's call, and T16 is unclear without a signal that Today is ready | Out: Today waits on open, push follows alpha |
| Q3 | Summary v3 for testers | **Listed for every account** once v3 lands (Recommended): it is in scope and v1's reason to hide it is gone | Owner only until a week of his own use |
| Q4 | G5 repo | **The planner repo** (Recommended): its card is already verified. The Action answers only users with write access (inferred from the action's defaults; checked on the run) | Another private repo |
| Q5 | G7: name the loop "Journal" in the UI | Owner's call, no recommendation: naming | — |
| Q6 | G9: where an empty-queue reply lands | **A new note the next run reads** (Recommended): no routing guess, nothing attached to the wrong Task | An answer attached to a chosen note or Task |

## 3. Gate rows added to SLICE-ACCEPTANCE §1 (on acceptance)

| # | Item | Held by |
|---|---|---|
| A8 | Restore-edit reconcile: an edit acknowledged after T survives a restore to T on every device | R1 test |
| A9 | Summary v3 listed for every account; lens test over done/pushed/open/dropped | R3 tests |
| A10 | No paste path in the code (D-113) | R4; typecheck + floor |
| A11 | Nightly export runs and covers the agreed scope | R6 test + one real run |
| A12 | H5 S3: Today arrives on a day the app was not opened; pause stops it; a second account's schedule never runs with the first's key | R7 tests + phone |
| A13 | G5: one real issue → Action → PR → merge shown on a card | R8, on the phone |

## 4. Session order

R1 first (largest blast radius, no dependency, closes the A7 finding). R2 next, so the H5 S3 decisions are with the owner
while R3–R6 are built. R8 and R9 run on the owner's side in parallel. R7 after the R2 answers. R10 last.
