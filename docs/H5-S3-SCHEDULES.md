# H5 S3 — Schedules (design addendum, S0)

**Status: decided 2026-10-16.** The owner accepted D-123 and D-125…D-130 as recommended, with two amendments (D-126 default
model, D-128 failure defined), took the alternative on D-124 (Morning only) and moved D-127 behind R1–R10. Gate row A12
([SLICE-ACCEPTANCE.md](SLICE-ACCEPTANCE.md), D-122). Builds on [H5-MODELS.md](H5-MODELS.md) (D-78…D-98) and
[HW-HARNESS.md](HW-HARNESS.md). Term: **Schedule** (D-138, renames D-89's *Routine*), a declared run bound to a time.
*Routine* now names a recurring personal item, parked (D-139). D-131…D-137 are Claude's (vibe-code); the owner may
reverse any of them before S3-1 merges. This file was `H5-S3-ROUTINES.md` until the rename.

## 1. Goal and acceptance

Today is ready in the morning without opening the app. A notification saying so comes later, after R1–R10 (D-127).

**Acceptance (A12).**
- (a) On a day the app was not opened before the schedule's hour, the first open shows that run's questions and Tasks at
  once, with no model wait.
- (b) The account's pause stops every schedule, and so does the operator's switch.
- (c) A Worker test shows a schedule of account B never reads A's rows or calls A's model (negative control).
- (d) Two cron ticks for the same hour start one run.
- (e) A tick skips a schedule whose earlier reply still waits unstored (D-128).
- (f) When notifications land (D-127): the notification carries no note text.

## 2. What the measurements already say

| Fact | Source | Consequence |
|---|---|---|
| A model call takes 10–58 s, and only a Workflow keeps it alive with no client | H5-S1-SPIKE, D-91 | A scheduled call runs in the same `ai_calls` Workflow as an on-demand run |
| A cron invocation may run 15 min. A `*/10` tick started 79 s late. 5 cron triggers per account | H5-S1-SPIKE E | A schedule's time is "around" its hour. One trigger is enough |
| Worker CPU per call: p50 6 ms, p99 17 ms. A Workflow step has a 10 ms CPU limit on the free plan. CPU follows bytes and rows (≈0.07–0.1 ms per row) | H5-S1-SPIKE D, memory `reference_cloudflare_free_plan_d1_facts` | **Composing and applying on the Worker is the risk.** Compose reads every row of the window, while apply reads all of them and writes many. The limit was not enforced at 35 ms, but it is the contract |
| The domain composers and parsers are pure, and the Worker already imports `src/domain/records.ts` | `api/src/aiCalls.ts` | Compose can run on the Worker without a second copy of the logic |
| No push code exists in the app (`PushManager` appears nowhere in `src/`) | grep, 2026-10-16 | Notifications are new infrastructure: VAPID keys, subscriptions, payload encryption |
| With several models there is no account default: each device picks, and a device that never picked follows the account's *only* model | `src/ai/runWith.ts` (D-102) | A schedule has no device, so D-126 needs a default mark on the account |

## 3. Owner decisions

| # | Question | Decided (owner, 2026-10-16) | Not taken | Why |
|---|---|---|---|---|
| D-123 | **Where a schedule's reply is checked and stored.** The model's reply (questions, Tasks, proposals), not the owner's done or carry, which stays on the Task | **The device, on its next open.** The Worker composes from D1 and calls the model while the app is closed. The reply waits in `ai_calls` (≤ 7 days, D-87), and the first device to open checks and stores it through the same path a manual run uses (`applyHarnessReply2`), with no model wait | The Worker checks and stores too (H5-MODELS §8 as first written), so records exist before any device opens | One writer for records. The apply-time recheck and its tests are reused. Only one step's CPU is at risk, not three. Both meet A12(a). The cost: a notification can't state Task counts, because nothing is applied yet. Reversible later: Worker-side apply can be added without changing the data |
| D-124 | **Which schedules at alpha** | **Morning only**: a harness run at 06:00 local, **on** by default once a model exists. *Evening* (Summary v3) is parked: it is a post-mortem, a second layer the owner runs against the alpha baseline. Re-entry: alpha baseline data exists and the owner starts that layer | Morning + Evening (Claude's recommendation) | Evening carries less value at this stage (owner) |
| D-125 | **Time granularity** | **Whole hours**, picked per schedule; the run starts within a few minutes after | Fixed times | One hourly cron covers every zone (half-hour zones run at their next whole hour) |
| D-126 | **Which model a schedule uses** | **The account's default model.** Settings → AI models gains a "default" mark; an account with one model has it by default. A per-widget model override is parked. Re-entry: a widget gets a scheduled run of its own (the Morning schedule runs the Journal, which no single widget owns, D-111) | Whatever "This device runs with" says on the last device used | "This device runs with" is per device (S2), and a schedule has no device |
| D-127 | **Notification** | **Deferred:** a pre-alpha candidate, entered only after R1–R10 are done (re-entry condition). The recommendation stands for that time: text-free and silent ("Your morning run is ready"), at most one per schedule per day, Android first | In S3 as its last PR (D-122 Q2 as first accepted) | The current list comes first (owner) |
| D-128 | **Failure** | **A failure is technical**: the provider refuses (revoked key 401, quota 429, provider down), the reply is cut off, or it does not parse. **3 in a row pause that schedule**; Settings shows why. **Not a failure:** the owner not opening the app. A tick **skips** a schedule while its earlier reply still waits unstored: no call, no cost, no count. A stored reply whose questions and Tasks go untouched is the harness's concern (questions never repeat, Tasks carry), not the schedule's | Keep trying daily; pause on the owner's ignoring | A revoked key otherwise fails every day unseen. Skip-while-waiting bounds an absence to one call and never guesses why the owner was away (absence is state, not intent) |
| D-129 | **Pause** | **Two switches.** "Pause schedules" per account in Settings (holiday, cost: stops only that account), and an operator switch (`SCHEDULES_PAUSED` Worker var): the owner's brake that stops every account's schedules at once, with no code deploy, when a prompt bug or a provider problem would spend testers' money or write bad Tasks everywhere | Account switch only | A8 asks for a global pause |
| D-130 | **The daily call cap** | **Scheduled calls count toward the same cap** (30 calls per 24 h per account, D-96) | A separate schedule budget | Morning only is 1 of 30. One cap is one number to explain |

## 4. Claude's decisions (vibe-code)

| # | Decision |
|---|---|
| D-131 | **Table `schedules`** (`0012`): `user_id, id, kind ('morning'), hour, zone, enabled, paused_reason, fail_count, last_day, last_call_id, created_at, updated_at`. No `model_id`: the run uses the account's default model at tick time (D-126). A row is created and changed only through authenticated routes, so its `user_id` is a session's. This is the A11 amendment D-44 named, written into ARCHITECTURE when S3-1 merges |
| D-132 | **One cron trigger, `5 * * * *`** (minute 5 of every hour). The tick selects due schedules (enabled, not paused, local hour ≥ `hour`, `last_day` < the local day in `zone`, **no reply waiting unstored** for `last_call_id`, D-128) and **claims** each with `UPDATE … SET last_day = ? WHERE id = ? AND last_day < ?`. Only a claimed row starts a run (A12(d)) |
| D-133 | **The Workflow gains a compose step before the call step**, for scheduled calls only. It reads the account's rows from D1 through the one data-access helper and runs the same `composeHarness2`. It stores the prompt in the call row and the run header (ids only, no text, D-87) in a new `header` column. The call step is unchanged. The step's CPU is measured with a 300-note synthetic account before merge. Over 10 ms, the compose step is split (read in one step, compose in the next) |
| D-134 | **The zone** is the one reported by the device that last saved the schedule. Each device updates it when its own zone differs (D-23: the zone comes from the device). Travel moves the schedule on the next open |
| D-135 | **A device finds the waiting reply on open.** A `GET /schedules/waiting` call returns finished, unstored scheduled calls with their header. The device applies the oldest first, then marks it stored (the existing `stored` PATCH). It does this before offering Get feedback, so an on-demand run never races a waiting scheduled reply. Two devices opening at once: the apply is idempotent per run id (L6), and the second gets `stored` |
| D-136 | **Web Push** (when D-127 re-enters): VAPID keypair as Worker secrets (the owner runs one command; RUNBOOK). Table `push_subscriptions` per device and session, removed with the session (D-22) and with the account (A3). Payload encryption (RFC 8291) on WebCrypto. A library only if `dependency-audit` passes it. A 410 from the push service deletes the subscription |
| D-137 | **The tester notice** gains one sentence: with a schedule on, the server sends your notes to your provider at the set hour while the app is closed, under the same terms as a manual run |

## 5. Slices

| Slice | Ships | Known positive first | Blast radius if wrong |
|---|---|---|---|
| **S3-1 schedules** | Account default model (D-126), `0012`, the routes, the cron, the compose step, `GET /schedules/waiting` with the device apply, Settings → Schedules (hour, on/off, pause, last run and status), D-128 auto-pause and skip-while-waiting | A due schedule on a test account produces a waiting reply; a paused one produces nothing; one with a reply waiting produces nothing; B's schedule reading A's rows fails the isolation test before the helper is wired | **Worker, stored keys, provider cost, with nobody watching.** A wrong due-check runs every hour (the claim, skip-while-waiting and the cap bound it to 30 calls a day per account); a wrong helper leaks between accounts (A12(c) holds it) |
| *S3-0 push spike* | *Parked with D-127.* The Worker sends one push to the owner's installed Android PWA (D-16's spike). Throwaway branch | The push arrives with the app closed; a deliberately wrong VAPID key is refused | None (spike Worker) |
| *S3-3 notifications* | *Parked with D-127.* Subscriptions, the send after a scheduled call finishes, Settings → Notifications per device | A notification test on a stub push service; the payload contains no note text (test searches for a planted note body) | Devices: a wrong cap spams; a wrong payload leaks note text to a lock screen (A12(f) test) |

S3-2 (Evening) is parked with D-124. Order: S3-1 is R7; S3-0 then S3-3 re-enter after R1–R10.

## 6. Not in S3

Evening and weekly or custom schedules. Routines in the new sense (D-139). Reminders with a time (D-07). Notification
actions (reply from the lock screen). A schedule proposing its own time (the model never schedules itself, 06 L8).
