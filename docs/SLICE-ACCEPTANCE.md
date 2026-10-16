# Slice acceptance — the one gate (2026-10-13)

**This file is the only acceptance gate for the vertical slice.** It replaces the separate gates in
[H1-ENTRIES.md](H1-ENTRIES.md) §1, [HW-HARNESS.md](HW-HARNESS.md) §1 and [H5-MODELS.md](H5-MODELS.md) S2; those sections
now point here. Decisions D-113…D-116 ([DECISION-TREE.md](DECISION-TREE.md)). Terms per [VOCABULARY.md](VOCABULARY.md).

The slice (owner, 2026-10-13): capture → sync → the **Journal** (model run, questions, answers) → **Today**, on the
widget model of D-107…D-111. It is enough to open alpha testing by invite (D-114).

Each item is **automated** (a named test proves it on every `pnpm check`, so CI holds it), **on the phone** (the owner
observes it), or both. An item marked automated is never dropped here without its test being dropped too, and a dropped
test lowers the raise-only test-count floor explicitly in the same PR.

## 1. Alpha gate — invites open when all are true (D-114, widened by D-122)

| # | Item | State |
|---|---|---|
| A0 | The declared slice is built: the widgets slice (D-107…D-111: Journal naming, Today, Widgets page with Notes/Vault and Summary suggested) | ✅ system widgets with per-account activation (`src/widgets/__tests__/system.test.ts`, two-device sync); the UI does not name the Journal yet |
| A1 | D-22: a user lists their own sessions and signs out everywhere (D-90: a stored key raises what a stolen session is worth) | ✅ Settings → Signed-in devices; `api/test/sessions.test.ts` (another account cannot list or end yours, the owner can; a revoked token is refused), D1 `0010` |
| A2 | The tester notice (D-52 pattern) is updated and sent by the owner: a model run sends the day's notes to the invitee's own provider, the invitee brings their own key (no paste path, D-113), export and delete exist | **not sent**; the 2026-10-10 draft says no AI service sees notes, no longer true |
| A3 | Export and delete-account (D-48, D-49) | ✅ `api/test/account.test.ts` (isolation; every row of the account removed, none of another's) |
| A4 | A second account sees nothing of the first: entries, records, models | ✅ `api/test/account.test.ts`, `api/test/models.test.ts` ("another account cannot read, edit, delete or test a model"), `api/test/aiCalls.test.ts` |
| A5 | `/log` gets its own low-limit binding (it shared the push per-IP limit, with no global cap on an anonymous D1 writer) | ✅ `RL_LOG_IP` 10/min per address, and a global cap of 200 reports per rolling 24 h read from the table itself (one row by key, no write when refused); `api/test/log.test.ts` "POST /log limits (A5)", each guard mutation-checked |
| A6 | A build older than the device's data never runs on it (Pages rollback past a Dexie bump). Redefined 2026-10-14: Dexie 4 does not fail to load on a downgrade, it opens and patches the newer database, so the risk is a stale build writing newer data, not a broken screen | ✅ `src/db/staleBuild.ts`: checked before Dexie opens, the app mounts only "Please update the app", no sync; `src/db/__tests__/staleBuild.test.ts` (a newer database is reported and left at its version; same version and a schema patch open; no database is not created; a newer build still upgrades), each comparison mutation-checked; `databases()` polled with a 1.5 s ceiling (a Safari hang starts the app as before, never a blank screen); a window already open reloads through the check when another upgrades the database; Reopen asks the service worker for the update. Seen in the pane: stored 80 stays 80, cold start and an open window both land on the update screen. Rollback floor in RUNBOOK |
| A7 | The restore path is known before testers depend on it: D1 Time Travel retention read on this account (the notice's `[N days]`), and RUNBOOK names what testers redo after a restore (model key, sign-in: server-only rows that devices cannot re-upload) | ✅ 2026-10-14: **7 days** (Free plan, Cloudflare docs); a bookmark resolves back to the creation day (2026-10-10), the limit itself measurable from 2026-10-18 (RUNBOOK). RUNBOOK §"Before and after a D1 restore": a read-only query counts what a restore to T would undo (run on prod: 1 session in the last day), and a table of what each count means for testers. **Found:** edits acknowledged after T to existing notes or records (Task done, answers) revert on every device. That is a sync gap, not this item; re-entry due (proposed: before the first invitee beyond the tester) |
| A8 | Restore-edit reconcile (D-122): an edit acknowledged after the restore point T (a Task done, an answer, a removal) survives a restore to T on every device that holds it | ✅ `src/sync/sweep.ts`; `records.test.ts` "restore-edit reconcile" (answer, Task done, three devices, and the negative control: a newer server row is taken), `engine.test.ts` "a note removed after the restore point stays removed"; the fake server now restores old versions, as Time Travel does |
| A9 | Summary v3, listed for every account (D-122 Q3) | ✅ `src/domain/summaryLens.ts`; `summaryLens.test.ts` (buckets, zone, M1–M3 + L1 review cases), `system.test.ts` "listed for every account" (#173). Phone: a real brief, owner |
| A10 | No paste path left in the code (D-113) | open — R4 |
| A11 | The nightly export runs and covers the owner's account only (D-122 Q1) | open — R6 |
| A12 | H5 S3: Today arrives on a day the app was not opened (Morning schedule); a pause stops it; a tick skips while a reply waits; a second account's schedule never runs with the first's key. Notifications deferred past R1–R10 (D-127) | open — R7 (design decided, [H5-S3-SCHEDULES.md](H5-S3-SCHEDULES.md)) |
| A13 | G5: one real issue → Action → PR → merge shown on a planner-repo card (D-122 Q4) | open — R8 |

Also re-enters at alpha, owner's call and not a gate item: the nightly export cron (deferred 2026-10-11; its proposed
re-entry is "before the first invitee beyond the tester"). Today's backup is each account's own export plus D1 Time Travel. Per invitee: one with an iPhone or iPad re-opens H1-S1-SPIKE step C (the installed-app sign-in return) before they sign in.

The owner's own acceptance (§2, §3) runs **alongside** alpha, not before it (D-114 amends D-80's order; D-122 keeps that). An invitee
without a key has capture and sync only. Invites: `node api/scripts/invite.mjs create <email> --remote` (RUNBOOK); the
first tester's invite expires 2026-10-24.

## 2. Capture and sync — one week, phone (installed PWA) and desktop, one account (D-115)

| # | Item | Automated | On the phone |
|---|---|---|---|
| C1 | Every note written on either device is on both and on the backend | `src/sync/__tests__/engine.test.ts` "a second device receives what the first captured" | yes |
| C2 | A note written offline, app closed and reopened, still shows unsynced and syncs on reconnect | `engine.test.ts` "offline: no request at all…", `src/notes/__tests__/group.test.ts` unsynced mark | yes |
| C3 | A push replayed twice creates one note | `api/test/sync.test.ts` replay ×3, `engine.test.ts` "a replayed push creates no second row" | — |
| C4 | A second account sees none of the first account's notes | A4 | — |
| ~~C5~~ | ~~Financial screens out of the nav, data reachable by URL~~ | **Retired:** the financial domain is deleted (D-112) | — |

## 3. The loop — three consecutive days, phone, a model run (D-115)

| # | Item | Was | Automated | On the phone |
|---|---|---|---|---|
| L1 | A run with the registered model stores what Check showed, with no copy or paste | H5 S2 (a) | — | yes (DEVICE-CHECKS 34) |
| L2 | A run over the day's notes stores questions; answering one changes what the next run asks | HW (a) | `src/harness/__tests__/loop.test.ts` (acceptance a), `harness2.test.ts` "an answered note question reopens its note" | yes |
| L3 | A Task marked done (or confirmed closed by a later note) is gone from the next day's Today | HW (b) | `loop.test.ts` (acceptance b) | yes |
| L4 | A Task pushed to tomorrow is in tomorrow's Today, not today's; one left open with no tap is still listed the next day, dated (overdue) — never silently gone | HW (c) | `loop.test.ts` (acceptance c, first half), `journal.test.ts` "still open and overdue" | yes |
| L5 | A cut-off or malformed reply stores nothing and the run says why | H5 S2 (b) | `harness2.test.ts` "refuses a reply cut off mid-string" | when it happens |
| L6 | The same reply applied twice for one run stores nothing more; a replayed step does not call the provider again | HW (d) | `loop.test.ts` (acceptance d), `harness.test.ts` REPLAY, `api/test/aiCalls.test.ts` "runs once" | — |
| L7 | The key is never returned to any client | H5 S2 (c) | `api/test/models.test.ts` "no response ever carries it" | — |
| L8 | A second account cannot call the first's model or see its marks | H5 S2 (d), HW (e) | A4 | — |

**Changed while merging (2026-10-13).** HW (d) said "the same *pasted* result"; the paste path is retired (D-113), so
L6 is the reply, however it arrived. HW (c)'s second half named the evening pass (D-65), which is not built; L4 keeps
the failure it was there to prevent (an open note silently leaving) and names how Today already prevents it: an open
Task stays, dated. **Not in this gate:** H5 S3 ("Today arrives on a day the app was not opened") stays H5 S3's own
acceptance; showing past days in the app is not required (owner: looking back belongs to the weekly horizon or another
retrospective tool, not decided).

## 4. What passing opens

| Passing | Opens |
|---|---|
| §1 | Alpha invites |
| §3 true on three consecutive days | The horizon drafts ([HORIZON-YEARLY-DRAFT.md](HORIZON-YEARLY-DRAFT.md)) and the weekly horizon / retrospective question |
| §2 and §3 | The slice is validated; the exit week is this gate, not a separate step |

## 5. Parked

- **Source-note retention (D-116).** Past a threshold, keep the reports and Tasks for tracking and clean up source notes
  that no longer matter. The criteria need research on a larger dataset; storage is text only and not a constraint at
  this scale. **Re-entry (proposed):** one account passes 5,000 notes, or D1 passes 50% of the free plan's storage.
