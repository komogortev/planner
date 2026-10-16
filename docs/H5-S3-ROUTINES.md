# H5 S3 — Routines (design addendum, S0)

**Status: S0 draft, 2026-10-16, for owner decisions.** Gate row A12 ([SLICE-ACCEPTANCE.md](SLICE-ACCEPTANCE.md), D-122).
Builds on [H5-MODELS.md](H5-MODELS.md) (D-78…D-98) and [HW-HARNESS.md](HW-HARNESS.md). Term: **Routine** (D-89), a
declared run bound to a time. D-123…D-130 below are the owner's to decide. Each is marked with a recommendation, and work
proceeds under it unless he changes it. D-131…D-137 are Claude's (vibe-code); he may reverse any of them before S3-1 merges.
**No S3 code until the owner has read §3.**

## 1. Goal and acceptance

Today is ready in the morning without opening the app, and (D-122 Q2) a notification says so.

**Acceptance (A12).**
- (a) On a day the app was not opened before the routine's hour, the first open shows that run's questions and Tasks at
  once, with no model wait.
- (b) The account's pause stops every routine, and so does the operator's switch.
- (c) A Worker test shows a routine of account B never reads A's rows or calls A's model (negative control).
- (d) Two cron ticks for the same hour start one run.
- (e) The notification carries no note text.

## 2. What the measurements already say

| Fact | Source | Consequence |
|---|---|---|
| A model call takes 10–58 s, and only a Workflow keeps it alive with no client | H5-S1-SPIKE, D-91 | A routine's call runs in the same `ai_calls` Workflow as an on-demand run |
| A cron invocation may run 15 min. A `*/10` tick started 79 s late. 5 cron triggers per account | H5-S1-SPIKE E | A routine's time is "around" its hour. One trigger is enough |
| Worker CPU per call: p50 6 ms, p99 17 ms. A Workflow step has a 10 ms CPU limit on the free plan. CPU follows bytes and rows (≈0.07–0.1 ms per row) | H5-S1-SPIKE D, memory `reference_cloudflare_free_plan_d1_facts` | **Composing and applying on the Worker is the risk.** Compose reads every row of the window, while apply reads all of them and writes many. The limit was not enforced at 35 ms, but it is the contract |
| The domain composers and parsers are pure, and the Worker already imports `src/domain/records.ts` | `api/src/aiCalls.ts` | Compose can run on the Worker without a second copy of the logic |
| No push code exists in the app (`PushManager` appears nowhere in `src/`) | grep, 2026-10-16 | Notifications are new infrastructure: VAPID keys, subscriptions, payload encryption |

## 3. Owner decisions

| # | Question | Recommended | Alternative | Why the recommendation |
|---|---|---|---|---|
| D-123 | **Where a routine's reply is checked and stored** | **The device, on its next open** (Recommended). The Worker composes from D1 and calls the model while the app is closed. The reply waits in `ai_calls` (≤ 7 days, D-87), and the first device to open checks and stores it through the same path a manual run uses (`applyHarnessReply2`), with no model wait | The Worker checks and stores too (H5-MODELS §8 as first written), so records exist before any device opens | One writer for records. The apply-time recheck and its tests are reused. Only one step's CPU is at risk, not three. Both meet A12(a). The cost: the notification can't state Task counts, because nothing is applied yet. Reversible later: Worker-side apply can be added without changing the data |
| D-124 | **Which routines at alpha** | **Two** (Recommended): *Morning*, a harness run at 06:00 local, **on** by default once a model exists; *Evening*, Summary v3 at 21:00, **off** by default | Morning only | Summary v3 is in scope (D-122 Q3), and an evening brief is its natural trigger. Off by default keeps the cost the user didn't ask for at zero |
| D-125 | **Time granularity** | **Whole hours**, picked per routine; the run starts within a few minutes after (Recommended) | Fixed times | One hourly cron covers every zone (half-hour zones run at their next whole hour) |
| D-126 | **Which model a routine uses** | **An account-level choice** in Settings → Routines, defaulting to the account's only model (Recommended) | Whatever "This device runs with" says on the last device used | "This device runs with" is per device (S2), and a routine has no device |
| D-127 | **Notification** | **Text-free and silent** (Recommended): "Your morning run is ready", no note text, no sound, at most one per routine per day. Android only at alpha; iPhone after H1-S1 step C | Counts in the text ("3 questions"); with sound | Privacy (A12(e)): a lock screen is public. Counts need an apply (D-123) |
| D-128 | **Failure** | **3 failed runs in a row pause that routine.** Settings shows why; one notification says it stopped (Recommended) | Keep trying daily | A revoked key otherwise fails every day unseen, while a model that answers badly still spends money |
| D-129 | **Pause** | **Two switches** (Recommended): "Pause routines" per account in Settings, and an operator switch (`ROUTINES_PAUSED` Worker var) that stops every account's routines without a code deploy | Account switch only | A8 asks for a global pause. The operator switch is the owner's brake when a prompt or provider misbehaves for everyone |
| D-130 | **The daily call cap** | **Routine calls count toward the same cap** (30 per day, D-96) (Recommended) | A separate routine budget | Two routines a day are 2 of 30. One cap is one number to explain |

## 4. Claude's decisions (vibe-code)

| # | Decision |
|---|---|
| D-131 | **Table `routines`** (`0012`): `user_id, id, kind ('morning' \| 'evening'), hour, zone, model_id, enabled, paused_reason, fail_count, last_day, last_call_id, created_at, updated_at`. A row is created and changed only through authenticated routes, so its `user_id` is a session's. This is the A11 amendment D-44 named, written into ARCHITECTURE when S3-1 merges |
| D-132 | **One cron trigger, `5 * * * *`** (minute 5 of every hour). The tick selects due routines (enabled, not paused, local hour ≥ `hour`, `last_day` < the local day in `zone`) and **claims** each with `UPDATE … SET last_day = ? WHERE id = ? AND last_day < ?`. Only a claimed row starts a run (A12(d)) |
| D-133 | **The Workflow gains a compose step before the call step**, for routine calls only. It reads the account's rows from D1 through the one data-access helper and runs the same `composeHarness2` (or the Summary v3 composer). It stores the prompt in the call row and the run header (ids only, no text, D-87) in a new `header` column. The call step is unchanged. The step's CPU is measured with a 300-note synthetic account before merge. Over 10 ms, the compose step is split (read in one step, compose in the next) |
| D-134 | **The zone** is the one reported by the device that last saved the routine. Each device updates it when its own zone differs (D-23: the zone comes from the device). Travel moves the routine on the next open |
| D-135 | **A device finds the waiting reply on open.** A `GET /routines/waiting` call returns finished, unstored routine calls with their header. The device applies the oldest first, then marks it stored (the existing `stored` PATCH). It does this before offering Get feedback, so an on-demand run never races a waiting routine reply. Two devices opening at once: the apply is idempotent per run id (L6), and the second gets `stored` |
| D-136 | **Web Push**: VAPID keypair as Worker secrets (the owner runs one command; RUNBOOK). Table `push_subscriptions` per device and session, removed with the session (D-22) and with the account (A3). Payload encryption (RFC 8291) on WebCrypto. A library only if `dependency-audit` passes it. A 410 from the push service deletes the subscription |
| D-137 | **The tester notice** gains one sentence: with a routine on, the server sends your notes to your provider at the set hour while the app is closed, under the same terms as a manual run |

## 5. Slices

| Slice | Ships | Known positive first | Blast radius if wrong |
|---|---|---|---|
| **S3-0 push spike** | The Worker sends one push to the owner's installed Android PWA (D-16's spike). Throwaway branch | The push arrives with the app closed; a deliberately wrong VAPID key is refused | None (spike Worker) |
| **S3-1 routines** | `0012`, the routes, the cron, the compose step, `GET /routines/waiting` with the device apply, Settings → Routines (hour, model, on/off, pause, last run and status), D-128 auto-pause | A due routine on a test account produces a waiting reply; a paused one produces nothing; B's routine reading A's rows fails the isolation test before the helper is wired | **Worker, stored keys, provider cost, with nobody watching.** A wrong due-check runs every hour (the claim and the cap bound it to 30 calls a day per account); a wrong helper leaks between accounts (A12(c) holds it) |
| **S3-2 evening** | The Evening routine over Summary v3 (after R3 merges) | A routine reply for Summary stores the same report a manual run does | Same as S3-1, one more composer |
| **S3-3 notifications** | Subscriptions, the send after a routine call finishes, Settings → Notifications per device | A notification test on a stub push service; the payload contains no note text (test searches for a planted note body) | Devices: a wrong cap spams; a wrong payload leaks note text to a lock screen (A12(e) test) |

Order: S3-0 runs alongside S3-1. S3-2 waits for R3, and S3-3 waits for S3-0 and S3-1.

## 6. Not in S3

Weekly or custom routines. Reminders with a time (D-07). Notification actions (reply from the lock screen). A routine
proposing its own schedule (the model never schedules itself, 06 L8).
