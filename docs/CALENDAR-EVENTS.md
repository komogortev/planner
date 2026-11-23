# Calendar events in the planner (Design)

**Status: proposed (2026-11-22). Design only; no feature code.** Owner asked 2026-11-22 whether the planner can sync
calendar events (INBOX `555c7aec`). This doc ends in one owner decision (§8). Terms per [VOCABULARY.md](VOCABULARY.md),
token storage per [GITHUB-BRIDGE.md](GITHUB-BRIDGE.md) §4 (G1), schedules per [H5-S3-SCHEDULES.md](H5-S3-SCHEDULES.md).

## 1. Goal and direction

The owner said "calendar events" and named no direction. **Assumed: read-only import.** Google Calendar events appear in
Today and in the Morning schedule's context. The planner never writes to a calendar.

| Direction | What it means | In scope |
|---|---|---|
| **Import (read-only)** | Calendar → planner: today's and the coming days' events show in Today and inform the Morning run | **yes (assumed)** |
| Two-way | Planner Tasks with a `due` date → calendar events, and edits flowing back | **no.** It needs a write scope (`calendar.events`), conflict rules for edits on either side, and it would break the rule that only an explicit request starts work (GITHUB-BRIDGE §1). If wanted later, a one-tap "add to calendar" on a single Task is a separate design |

## 2. Facts checked (2026-11-22)

Labels: **measured** (run here), **code** (read in this repo), **inferred** (from general knowledge, not checked),
**to verify** (must be checked before the slice that relies on it).

| Fact | Finding | Label |
|---|---|---|
| Calendar code in the planner | None. The only event-date field is `occurredAt` on an Entry (`src/domain/entry.ts:7`, "YYYY-MM-DD when the event date differs from capture"), set `null` at capture and unused in practice (HW-HARNESS C4) | code |
| Task dates | A Task carries `due` and `followUpOn`, both plain dates (`src/domain/records.ts:249`) | code |
| Sign-in scope | Google sign-in asks `openid email profile` (`api/src/auth.ts:38`); GitHub sign-in asks `read:user user:email` | code |
| Cron | `5 * * * *` runs `runSchedules` (the Morning schedule tick); `17 7 * * *` runs the nightly export (`api/src/index.ts:97`, `api/wrangler.toml`) | code |
| Secret storage | `sealKey` / `openKey` in `api/src/keyBox.ts`: AES-GCM under `MODEL_KEY_SECRET`, associated data binds user, slot and target. Used for model keys and the G1 GitHub token (`api/src/integrations.ts`). Regenerating `MODEL_KEY_SECRET` orphans every sealed value | code |
| `integrations` table shape | Primary key `(user_id, provider)`: one row per provider, so several calendar addresses don't fit it (migration `0011`) | code |
| Morning compose input | `loadHarnessData` reads entries and five record kinds from D1 (`api/src/schedules.ts:129`); the composer is the device's `composeHarness2` | code |
| ICS parse cost, plain events | `ical.js` 2.2.1 (MPL-2.0, no deps, ~1 MB unpacked) on Node, synthetic feed of 500 one-off events (180 KB): parse 4–8 ms, walk 20–35 ms | measured |
| ICS cost, recurring series | Same feed with 20 open-ended weekly series that start in 2018: walking a 14-day window costs **~500 ms**, i.e. ~25 ms per series. `ical.js` iterates each series from its `DTSTART`; it can't jump ahead to the window | measured |
| Text pre-filter | Splitting a 1.5 MB feed on `BEGIN:VEVENT` and keeping only blocks with an `RRULE` or a `DTSTART` inside the window: 1–6 ms | measured |
| Workers free-plan CPU | 10 ms CPU per invocation, cron included; 50 subrequests per invocation. STATE already lists "compose CPU vs free-plan step limit" as unverified for R7 | inferred; to verify |
| Google secret iCal address | Each calendar has one under Settings → Integrate calendar. It is a bearer URL: anyone holding it reads every event with full details. "Reset" invalidates it. A Workspace admin can turn it off. The feed carries the calendar's whole history, not a window, and Google refreshes it with a lag of hours | inferred; to verify (feed size and lag at step E0) |
| CORS on the iCal address | A browser fetch from `koplanner.pages.dev` is blocked, so the fetch has to run on the Worker | inferred; to verify |
| Google Calendar API | `events.list` with `singleEvents=true` and `timeMin`/`timeMax` returns recurring series already expanded, as small JSON; `syncToken` gives incremental reads. Server-side parsing cost is then trivial | inferred; to verify |
| `calendar.readonly` scope | A **sensitive** (not restricted) scope. While the OAuth app is in "Testing" status, at most 100 listed test users, and **refresh tokens expire after 7 days**. Verification needs a privacy policy, a homepage and a verified domain; whether `pages.dev` qualifies is open | inferred; to verify |
| Calendar connector (Claude) | Reads the owner's calendars in a Claude session today (three calendars visible, checked by the starting session 2026-11-22) | stated by the starting session |

## 3. Options

### (a) Secret iCal address per calendar, fetched by the Worker

The user pastes each calendar's secret address in Settings → Integrations → Calendars (the G1 pattern). The Worker
stores it sealed, fetches it on a cron, keeps only the events inside a window (yesterday to +14 days), and writes them
to a server cache table (§5). The app reads the cache.

- **Cost:** a migration, 3 routes, a fetch-and-parse job, one parser dependency (`dependency-audit` first; `ical.js` is
  the candidate, ~1 MB unpacked, tree-shaking unknown), a Settings section, a Today strip. Size M.
- **No Google relationship:** no OAuth app change, no verification, works for GitHub-signed-in accounts the same way.
- **Failure modes:**
  1. **CPU.** Measured above: a few old weekly series cost more than the whole free-plan budget. Ways out, each with its
     own cost: a hand-written expander that jumps to the window for the common rules (`DAILY`/`WEEKLY` with
     `INTERVAL`, `BYDAY`, `UNTIL`, `COUNT`, `EXDATE`) and falls back to `ical.js` for the rest (bug risk in time zones
     and DST); the Workers paid plan ($5 a month, 30 s CPU; money, so the owner's call); or one Workflow step per feed
     (still 10 ms each on the free plan, inferred).
  2. **The address is a bearer secret.** Stored with `sealKey` under a new slot; no response returns it (the G1 test
     that searches responses for the token is reused); the UI shows the last 4 characters. A leak exposes the full
     calendar, not just what the planner shows. **Never regenerate `MODEL_KEY_SECRET`**: every sealed value would stop
     opening.
  3. **Silent staleness.** Google's own feed lags by hours and the cron adds up to an hour. Each feed shows "updated
     *time*" and its last error (`401/404` = address reset → "paste the new address").
  4. **Subrequests.** One fetch per feed per tick; 50 per invocation caps accounts × feeds. Fine for the owner, a limit
     for testers.
  5. **Time zones.** All-day events are dates, not instants; events use `TZID` from the feed. Rendered in the account's
     schedule zone (`validZone` in `schedules.ts`).

### (b) Google Calendar API with `calendar.readonly`

A separate **Connect Google Calendar** button in Settings, using incremental consent. It is not added to sign-in, so a
GitHub-signed-in account can connect too. This corrects the brief's premise that GitHub accounts are left out. The
Worker stores the refresh token sealed and calls `events.list` (`singleEvents=true`).

- **Cost:** a second OAuth flow with refresh-token storage and rotation, the Google consent screen set up for a
  sensitive scope, and then the same cache, routes and UI as (a). Size M–L.
- **Wins over (a):** Google expands recurring series, so CPU stays trivial; correct expansion and exceptions; incremental
  sync; no bearer URL in our database.
- **Failure modes:**
  1. **Testing status: refresh tokens die after 7 days** (to verify). Every user reconnects weekly until the app is
     verified.
  2. **Verification** before more than 100 users: privacy policy, homepage, domain proof. It is outward-facing work done
     under the owner's name, and it moves on Google's timeline.
  3. A wider blast radius: one leaked refresh token reads every calendar the account has, not only the ones chosen.

### (c) No planner code: Claude sessions read the calendar directly

A Claude session reads the calendar through the Google Calendar connector and merges it with the local export
(`node api/scripts/export-local.mjs <email> --remote`, RUNBOOK "Local export").

- **Cost:** zero planner code. Usable today.
- **Failure modes:** the phone app shows nothing; the Morning schedule runs on the Worker with nobody watching, so it
  can't see the calendar; it only helps when a session runs.

### My lean, challenged

The brief's lean was (a) for the app and (c) now. **(c) now holds.** **(a) holds only if E0 shows the real feeds fit
the CPU budget once pre-filtered**, i.e. few open-ended old recurring series, or if the owner accepts the paid plan.
Otherwise (b) is the better app path despite its Google overhead, because it moves the expensive, error-prone part
(recurrence expansion) to Google. So the app path is **(a), gated by E0**, with (b) as the named fallback, not a peer.

## 4. Recommendation

1. **Now:** (c). No code. A session that needs the calendar reads it through the connector.
2. **App:** (a) behind step E0, sequenced after R10 (§7). If E0 fails the budget: the owner picks the paid plan or (b).

## 5. Data model

**A server-side cache, not a record kind.**

| | Record kind (`records` table, synced) | Cache table (Worker-written, not synced) |
|---|---|---|
| Who writes | Devices push, the Worker stores | The Worker only; devices read |
| Fit | User-authored data with versions and offline edits | External, read-only, can be rebuilt from the source any time |
| Sync engine | A new kind: every older build drops the rows and doesn't re-pull them (GITHUB-BRIDGE §2 fact, needs a re-pull like G2) | Untouched |
| Export | Enters the export and every consumer of it | Left out; the calendar stays the source of record |
| Edits | A device could edit an event and push it | Nothing to push |

Proposed migration `0013` (additive):

- `calendar_feeds`: `user_id, id, label (the user's own, ≤ 40), url_ct, url_iv, url_hint, key_version, last_fetch_at,
  last_status, created_at`; primary key `(user_id, id)`; at most 5 per account. A new table, because `integrations`
  allows one row per provider.
- `calendar_events`: `user_id, feed_id, uid, recurrence_id, starts_at, ends_at, all_day, title (≤ 200), fetched_at`;
  primary key `(user_id, feed_id, uid, recurrence_id)`. Each fetch replaces a feed's rows for the window in one batch,
  so a cancelled event disappears. No location, description or attendees: what isn't stored can't leak.
- Route `GET /me/calendar?from=&to=` returns the events and each feed's `{ label, updatedAt, lastStatus }`. On the
  device, either an in-memory fetch on open or a Dexie table outside the outbox. A Dexie table is a version bump, and
  the rule "never roll Pages back past a Dexie version bump" then applies. **Proposed: in-memory with the last response
  in `localStorage`, no Dexie change.**

**In Today.** The Daily card's "Coming up" gets the day's events above the Tasks, time first, then the title, marked as
calendar items, and none of them can be ticked. Tomorrow shows collapsed. A feed in error shows one line with the
fix.

**In the Morning schedule.** `loadHarnessData` adds today's and tomorrow's events (in the account zone).
`composeHarness2` gets a read-only "Calendar" context section. The events aren't assessed and get no ids in
`toAssessIds`, so the run can mention a clash ("dentist at 10, the errand is due today") but never edits an event. **Event
titles then reach the user's own model provider**, so the R10 tester notice must say so.

**Relation to `occurredAt`.** None needed. `occurredAt` is the past date of something an entry describes; an event is
a future fact from another system. A later "note about this event" link is possible, not proposed.

**Relation to the "Window" kind (INBOX `cb86a0d7`).** A Window is user-authored: an end date, an action, an end rule.
An event is external and read-only. If the Window ships, an event may get a "make a Window" tap (explicit, one at a
time), never an automatic conversion. The two designs share the Today rendering of "time-bound item, not a Task".

## 6. Slices (prefix E; C and G are taken by the GitHub bridge)

| Slice | Ships | Evidence before merge |
|---|---|---|
| **E0** | Measurement on the owner's PC, no code in the repo: each feed's byte size, event count, count of open-ended recurring series (counts only, nothing personal), Google's refresh lag, and the pre-filtered parse time under `wrangler dev` | numbers in this doc; go / paid plan / (b) decided |
| **E1** | `calendar_feeds`, sealed address, `PUT/GET/DELETE /me/calendar/feeds`, Settings section | the address never appears in any response; B can't see A's feeds; a malformed or non-HTTPS address writes 0 rows |
| **E2** | Fetch job on the hourly tick: pre-filter, parse, expand into the window, replace rows | fixtures written by hand (synthetic, no real titles): DST change, all-day, `EXDATE`, moved instance (`RECURRENCE-ID`), cancelled event, `TZID` missing; CPU logged per feed |
| **E3** | `GET /me/calendar` + Today rendering | an event can't be ticked or edited; a feed in error shows its fix |
| **E4** | Morning compose context section | the prompt carries titles only, inside the window; no event id among the assessed ids |

The Worker deploys before the app, as in RUNBOOK §Deploy. Prod deploys are the owner's.

## 7. Sequencing against D-122

D-122: the alpha is full scope, and every item goes through R10 first (ALPHA-TEST-PLAN §2). Calendar import isn't on
the R list. Adding it before R10 would:

- add Worker CPU to a budget R7 hasn't measured yet (STATE: "compose CPU vs free-plan step limit" unverified);
- widen the R10 notice (calendar titles sent to the model provider, a bearer address stored);
- add a fourth sealed-secret path before the third (G1) has had its expiry case handled (INBOX `fff27f59`).

**Proposed: sequence after R10.** Use (c) until then. E0 is a measurement with no repo change, so it can run any time
without jumping the queue.

## 8. Owner decision

**Q1.** Calendar events in the planner: how and when?

- **(Recommended) (c) now, (a) after the R10 gate, gated by E0.** No planner code until R10. E0 runs before E1, and if
  the feeds blow the CPU budget the owner picks the paid plan or (b).
- (a) now, ahead of R10: jumps D-122's queue, widens the alpha notice.
- (b) after R10: Google verification and the weekly reconnect accepted to get Google-side expansion.
- (c) only, no app feature.

If there's no answer, work proceeds under the recommendation: no planner code; the INBOX line stays open with
re-entry condition "R10 gate passes".
