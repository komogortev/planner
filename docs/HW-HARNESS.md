# HW — Harness and the first prompt widget (Design)

**Status: S0 draft, 2026-10-11. Decisions D-60 … D-63 are the owner's (2026-10-11); §9 holds what is still open. No code until §9 is read.**
Terms per [VOCABULARY.md](VOCABULARY.md); invariants per [ARCHITECTURE.md](ARCHITECTURE.md); run lifecycle per ARCHITECTURE §6; lens and report shapes per [H2-LENSES.md](H2-LENSES.md).

## 1. Goal

Give the exit week a reason to run. H1 delivers capture and sync; nothing yet *uses* what was captured. This tier adds one loop the owner wants every day:

> capture → **harness** reads new notes, links them to older ones, asks short questions → owner answers, confirms "done" → a **widget** (first: *Daily task journal*) reports today's commitments from the marked notes.

**Acceptance.** On the owner's phone, for three consecutive days: (a) a harness run over that day's notes stores questions, and answering one changes what the next run asks; (b) a note the owner marks done (or confirms as closed by a later note) is absent from the next day's journal; (c) a note carried to tomorrow appears in tomorrow's journal and not today's, and a note left open with no tap is listed in the next evening's pass (D-65); (d) replaying the same pasted result twice changes nothing; (e) a second account sees none of the first account's marks (isolation, same test as H1 §8).

## 2. Decisions (owner, 2026-10-11)

| # | Decision |
|---|---|
| D-60 | **First slice = harness plus the Daily task journal widget** (not the harness alone): the smallest thing worth opening the app for each evening |
| D-61 | **Two stages.** Stage 1 (harness) marks notes once; stage 2 (widget) reads the marks. A widget re-run never repeats the assessment |
| D-62 | **Separate tables** for questions, links, per-note state and assessments. An Entry stays exactly as H1 defines it; AI text never lives on it |
| D-63 | **Executor = copy-prompt** (D-35) for both stages. No API key, no per-token cost; the owner is the one who sends the data. H5 re-enters only on the evidence in §7 |

## 3. Stage 1 — the harness

One prompt, owned by the app (versioned: `harnessVersion`), inherited by every prompt widget's data. Built by the one composer (A2): the owner never edits it in this slice.

**Input (the candidate set), all from the signed-in account's on-device copy:**
- notes **open** (not done, not dropped, not deleted) with **no assessment at the current `harnessVersion`**, or with a question **answered after their last assessment** (the answer is new information; this is what lets answering change the next run);
- plus, as *context only*, notes still `open` created in the last 7 days (so a new note can close an old one), newest first;
- each note with its id, capture time, event date, body **and its question–answer record**. An answer counts as content: a question the record already answers is never asked again, nor one the owner dismissed;
- hard cap on candidates (default 60, oldest context dropped first, said so in the run header).

**Output (strict JSON only; anything else is refused with the reason shown):**

```ts
interface HarnessOutput {
  assessments: Array<{
    entryId: string                                     // must be in the candidate set AND unassessed
    questions: Array<{ text: string }>                  // 0–3, short, never repeating answered/dismissed ones
    closes: Array<{ entryId: string; evidence: string }> // proposes: this note concludes that older note
    followUp: { entryId: string; on: string } | null    // proposes: carry that note to YYYY-MM-DD
  }>
}
```

**Rules baked into the prompt** (patterns from the owner's prior journal tooling, restated generically): conservative — a wrong link is worse than a missed one; a due date only when the text implies one, and then also one question asking which earlier day to pick the note up (D-66); evidence is a one-line quote; nothing is invented about people or places.

**Validation before anything is stored** (`validateHarness`, pure): unknown or already-assessed `entryId` → that assessment dropped and counted; a 4th question dropped; a question whose normalized text matches an existing one on that note dropped; `closes`/`followUp` targets outside the candidate set, no longer open, or pointing at the note itself (closes only) dropped; a close by a note that is not newer than the one it closes dropped; a follow-up date that is malformed, in the past (settings zone) or more than 366 days away dropped; a pair already proposed once, in any state, is never proposed again; an assessment of a note that was deleted, done or dropped after the prompt was composed, or that another run assessed *after* this prompt was composed (a stale paste), dropped; model text holding a lone UTF-16 surrogate dropped; cuts are by code point, never mid-emoji. **"Today" and the assessment time are the moment the prompt was composed, not the paste**: the model was told that day, and an answer given between compose and paste must still re-open the note; malformed JSON → nothing stored. Closes and follow-ups are stored as **proposed**; only the owner's tap confirms them (the owner, or "the owner confirming the harness", is the only author of `done`).

**Idempotency.** Every stored row's id is derived from its natural key (uuid v5: assessment = `entryId + runId`, question = `entryId + normalized question`, link = `from + to + kind`). A run that already stored an assessment for a note is a replay: nothing more is stored. A *later* run may assess the same note again. Pasting the same result twice, on one device or on two, produces the same ids, so replay is a no-op and sync merges cleanly.

## 4. Stage 2 — the widget

A **prompt widget** holds a lens (D-32). *Daily task journal* ships as the first, built in, not owner-edited in this slice.

- **Slice** (pure, `resolveSlice` extended): notes dated today in the settings time zone, plus notes whose `followUpOn` is today, plus notes `open` and carried. A note dated earlier and not carried is not read by a daily widget (calendar rule). `done`/`dropped` notes are excluded; they appear only as context when a today's note closes them.
- **Prompt** carries each note's marks: state, confirmed links, answered questions. The model is asked for today's commitments as a checklist with citations by entry id.
- **Report**: immutable, stored per ARCHITECTURE §6 step 5–6 (a second reply for a run that already has a report is refused, never stored over it); citations to entries outside the slice, quotes shorter than 8 characters (a shorter note is cited whole), and quotes that are not in the cited note (as written, or as shown in the prompt) are dropped and flagged; an empty slice makes no copy at all ("nothing today").
- The widget's last report shows in its own body and, once activated, on the Dashboard with its age (D-36). Whether the Dashboard shows the full report or a summary opens the widget is the owner's call at UI time (§9 Q3).
- **No Task record, no hook index** (D-34, D-39): commitments are found at run time and shown in the report. What is stored is only marks *about notes* (state, link, question, assessment). If the owner wants commitments tracked past a day, that is the evidence that builds Task (H4), not this slice.

## 5. Data (Dexie v5 · D1 `0008`)

**Server (D-64): one `records` table** keyed `(user_id, kind, id)`, the kind's own fields as one JSON text in a fixed key order (`record_revisions` keeps what a stale edit replaced). **Device: one Dexie table per kind.** Every row carries `serverVersion` and soft delete and travels through the **existing outbox and per-account cursor** (the cursor is `users.version_seq`, already shared by every table, so one cursor covers all kinds). A mutation names its kind in `recordKind`; without it, it is a note, exactly as before. The column list below describes the fields each kind holds, wherever they are stored. Validation is one rule set shared by app and Worker (`src/domain/records.ts`).

| Table | Columns (beyond the common ones) |
|---|---|
| `assessments` | `entryId`, `harnessVersion`, `runId`, `at` — "processed" is *a row exists at the current version and no answer is newer than it* (D-61) |
| `questions` | `entryId`, `text`, `state open·answered·dismissed`, `answer \| null`, `createdAt`, `answeredAt`, `runId` — the answer is the owner's own text, stored here, never on the Entry |
| `links` | `fromEntryId` (the note that gave the evidence), `toEntryId` (the note concluded, or carried), `kind closes·carries`, `onDate` (carries only), `state proposed·confirmed·rejected`, `evidence`, `runId`. A carry may point at its own note. The model only ever creates `proposed`; confirming sets the note's `entryStates` row |
| `entryStates` | `id = entryId`; `state open·done·dropped`, `followUpOn \| null`, `by owner·confirmed-proposal`, `updatedAt` — one row per note that has left the default (absent = open) |
| `widgets` | `name`, `kind system·prompt`, `active`, `lens {instruction, shape, version} \| null`, `lineage \| null` |
| `reports` | `widgetId`, `lensVersion`, `runId`, `entryIds`, `body`, `citations`, `executor 'copy-prompt'` |
| `runs` | `stage harness·widget`, `version`, `entryIds`, `ranAt`, `executor` — the composed header (A2), so any result can be explained |

**Vocabulary rows to add before code** (VOCABULARY rule): Harness, Assessment, Question, Link, Entry state, Run (widened to both stages). `Hook` stays unstored.

## 6. Blast radius — where a change would reach

Pre-release: every module may change together; the tester has 0 entries, so a schema change costs nothing now. After release the boundary rows (stored data, push/pull shape) must be additive only.

| Change | Reaches | Why it is the risky one |
|---|---|---|
| Sync made kind-aware (`src/sync/engine.ts` 489 lines, `api/src/entries.ts` 270, `api/src/sync.ts`) | outbox, push/pull, conflict rules, **every existing sync test**, the entry path that works today | Entry-specific today. A bug here costs captured notes, not just harness data. Gate: the 316/147 existing tests plus a per-kind isolation and replay test before any harness UI |
| Dexie v5 + D1 `0008` | all devices on next open | Additive tables only; never edit v4 (frozen) |
| Harness prompt wording | stage 1 output only | Versioned: bumping `harnessVersion` re-assesses, which re-asks questions; so it bumps rarely and says so |
| Domain code (compose, validate, apply) | nothing outside itself | Pure, synthetic fixtures; no clock or storage reads |

## 7. Evidence this slice must produce

- **Paste count per day** (from `runs`): the two-stage design costs up to two copy–paste round trips. This number is the re-entry evidence for H3 (D-37); more than ~3 a day for a week is the signal.
- **Questions asked vs answered vs dismissed**, per day: an unanswered majority means the harness is noisy (lower the cap or sharpen the rule), not that the loop works.
- **Closes proposed vs confirmed vs rejected**: the harness's precision, measured, not assumed.

## 8. Privacy

The prompt is built only from the signed-in account's on-device notes. The run header shows how many notes will leave the device before the owner copies. Clipboard cleared after the timeout (D-54). No note content, answer or report reaches the public repo's fixtures or docs: fixtures are synthetic.

## 9. Slices of work and open points

| Slice | Content | Done when |
|---|---|---|
| **S0** | This doc; D-60…D-63 and the VOCABULARY rows recorded | owner reads §9 |
| **S1 Domain** ✅ (CodeReview round 1 fixed: 8 findings, 7 confirmed and fixed, 1 low-impact accepted with a test) | `src/domain/{uuid5,harness,journal}.ts`: selection, compose, `parseHarnessOutput`, `applyHarness`, the owner's transitions, journal slice + compose + `validateReport`. Pure, no UI, no sync | 85 tests incl. replay ×2 → nothing written, two devices → same ids, foreign id / 4th question / repeated question / past date / foreign or invented citation dropped, acceptance (a)(b)(c) end to end on synthetic notes; each of 32 guards removed in turn turns the suite red |
| **S2 Schema + sync** ✅ (CodeReview: 0 critical, 4 improvements, all handled or gated below) | Dexie v5, D1 `0008`, kind-aware push/pull, merged pull under one cursor, account export/delete/clear/copy cover records, `writeRecords` | the 316/147 pre-existing tests unchanged and green (now 453 app / 169 Worker); 37 of 38 guards removed in turn turn the suite red (16 Worker, 22 client; the 38th is redundant with the validator); replay, isolation, same-id-two-kinds, stale-edit revision, CAS race, rewind sweep, rejected + discard, v4→v5 upgrade proven. **Not run: production smoke (the Worker is not deployed).** |
| **S3 gates (from the S2 review)** | **Step 0: deploy the S2 Worker (and `0008`) BEFORE any client that writes records is merged** — Pages builds from `main` on its own, the Worker does not, and an older Worker rejects every record push, which the client then keeps as refused until the owner presses Retry. Records are never deleted and re-created under the same id (a deleted id stays deleted on the server): use `state`. Surface the count of server records a device could not store (today a console warning only). A rejected record's Discard deletes the owner's text: the label shows it, and the saved copy should hold discarded payloads. Pull pages of 100 can carry up to 64 KB per record: watch the size once reports exist | — |
| **S3 UI** | Run harness (copy → paste box → preview of what will be stored), questions on the note, done / carry-to-date taps, **evening pass with done · carry to tomorrow · drop (D-65, D-67)**, **lead-time question on in-text due dates (D-66)**, Widgets page create + activate, Dashboard shows the journal | DEVICE-CHECKS rows written, then run on the phone |
| **S3a Thin loop** ✅ built 2026-10-11 (CodeReview: 0 critical, 6 improvements — 5 fixed, 1 deferred below) | Dashboard: Daily task journal card with step 1 (harness) and step 2 (journal), each copy → paste → Check → Store; the pending run header kept in localStorage (survives the phone killing the app; cleared with the device); Copy again from the tap; report rendered as plain lines (no HTML, no link targets); per-note questions (answer · skip), proposals (yes · no), carried badge + owner pick-up date (D-66). Zone = the device's (always valid). Language = the note's own. Prompt gains the D-66 lead-time rule (v1 wording; no run ever stored at v1) | 477 app tests; 4 guards mutated red; the loop clicked through on a local build with synthetic notes (compose, planted bad target dropped, store 8 rows, confirm close → done + struck, carry → pick-up date, journal slice = 1 note, unsupported citation flagged, link target stripped, 375 px no overflow). **Not run:** a production run on the phone; a real model reply; the clipboard write on a phone |
| **S3b Rest of S3** | Evening pass (done · carry to tomorrow · drop, D-65/D-67), Widgets page create + activate (the journal shows unconditionally until then), DEVICE-CHECKS 18–20 | as S3 UI |
| **S4 Use** | The exit week, now measuring a loop (H1 §1 acceptance plus §1 above) | §1 true on three days |

**Open — each with the default I would proceed under:**

1. **D-34 reading.** Stored marks about notes (assessment, link, state) are not an extracted hook index. *Default: yes, consistent.*
2. **Context window for stage 1:** 7 days of open notes, cap 60. *Default as written.*
3. **Dashboard shows** the full report or a one-line summary opening the widget. *Default: summary + age; decide at S3.*
4. **Language of questions** from settings, not from the prompt (H2 §4.5). *Default: yes.*
5. **Entry-state `dropped`** exists in the schema; UI in S3 inside the evening pass. *Accepted 2026-10-11 (D-67).*
6. **An overdue carried note resurfaces in every daily journal until marked done** (tested on purpose). Intended, or should it fall out after N days? *Default: keep resurfacing; revisit on evidence from the exit week.*
8. **Found in S3a — a lead-time answer cannot become a second carry.** The spec (§10 C2) says the answer sets `followUpOn`, but a carry's id is derived from `from|to|carries`, so the next run's new date for the same note is dropped as `repeated-link`. Resolved in UI: a carried note offers the owner's own pick-up date (`by: owner`, outranks proposals). The harness re-asking stays harmless.
9. **Deferred from the S3a review — deleted records would be re-created.** `loadHarnessData` hides deleted rows, and `applyHarness` builds its "already known" id sets from them, so a deleted assessment / question / link would come back under the same uuid5 id (the Worker keeps it deleted and flags a conflict). Latent: no client code deletes a record today. **Re-entry: before any client code sends a record delete** — build the known-id sets from all rows, deleted included.
7. **S3 carry-overs from review:** the report body is untrusted model markdown, so the renderer must disable HTML and links; `localDay` throws on an invalid zone, so Settings must guarantee a valid one.

## 10. Calibration from the first real notes (2026-10-11) — C1–C4 accepted (owner, D-65…D-68); C5–C6 parked

**Basis.** The one production account held 11 notes: 6 dev test strings, and 5 written from the phone in about fifty minutes away from the desk — 3 errands (one with a deadline inside its text), 1 request for a spec, 1 statement of purpose. Small n, and the harness has **not** been run on them (no S3 UI yet): this is a paper walk-through of §3–§4 against real capture, a probe of the spec and not a measurement. Note text is not reproduced here (public repo).

| # | What the notes showed | Spec it hits | Proposed change | Default I would proceed under |
|---|---|---|---|---|
| C1 | Most real notes were undated errands. §4 reads a note dated earlier only if it is carried; nothing in the spec makes the owner carry it. A note not done and not carried **silently leaves the journal the next morning** — the failure the journal exists to prevent | §4 slice, acceptance (c) | S3 UI gets an **evening pass**: today's open notes and overdue carried ones, each with one tap — done · carry to tomorrow · drop. The calendar rule is unchanged; the pass is where the owner applies it. Acceptance (c) gains: "a note left open with no tap is listed in the pass the next evening" | Yes |
| C2 | A deadline written in the body (`by <date>`) is the only date the note has. A `followUp` to the deadline day shows the note on the day it is due, with no lead time | §3 `followUp` | When the text implies a due date the assessment carries a `followUp` to that day **and** one question asking which earlier day to pick it up. The answer sets `followUpOn`. No new field | Yes |
| C3 | Statements of purpose and junk strings are not commitments and never become done. With no way out they stay `open` as 7-day context and as clutter in the pass | §9 open point 5 | `dropped` gets UI in S3, inside the evening pass. The harness still never sets it (the owner is the only author of state) | Yes — flips point 5 |
| C4 | No note had an event date. Capture is typeless (D-07), so a window on `occurredAt` never fires | H2 §2 `windowField` | Do not rely on `occurredAt` in the daily slice; windows run on capture date and `followUpOn`, as §4 already says | Yes — no change to §4 |
| C5 | One note asks for widgets at several horizons (daily, weekly, monthly, yearly, life goal). §3–§4 are daily-only; the 60-note cap and 7-day context fit weekly at the observed rate, not beyond | §3 cap, §4 slice | **Constraint for the horizon spec, not built now:** a horizon is a calendar window plus a source. Daily and weekly read notes; monthly and above read the **reports** of the horizon below (reports are immutable and cite their sources), so citations become transitive and `validateReport` must accept a report as a cited source. Fewer raw notes leave the device at higher horizons. `records` holds each kind as JSON, so adding a source field later is additive | **Parked (owner, 2026-10-11): this slice keeps the daily loop only.** Draft: [HORIZON-YEARLY-DRAFT.md](HORIZON-YEARLY-DRAFT.md). Re-entry: HW-HARNESS S4 acceptance (§1 a–e true on three consecutive days) |
| C6 | The stated purpose is corporate-style sprint organisation brought to personal space | PROJECT.md Vision, VOCABULARY | One sentence added to the Vision. Proposed term **Horizon** (daily · weekly · monthly · yearly · life) for the code; "sprint" stays framing only — it implies a committed backlog, which the calendar-window design does not have. VOCABULARY gets the row in the horizon spec's session, before any code (parked with C5) | Yes |

**Not covered by the notes:** whether the harness's questions are worth answering (no run yet), the paste count per day (§7), and what the owner's other journaling tool's yearly view does — a note equates it with the yearly horizon; it was not read in this session, so the equivalence is the owner's claim, uncalibrated.

## 11. S3 v2 — tasks derived from notes (DRAFT for owner read, 2026-10-11)

**Why.** The first real run (12 notes, 10 questions, 1 carry) showed the owner the S3a shape is wrong in three ways (owner,
2026-10-11): the surface is the notes themselves (raw input, often several topics in one note); questions sit on note rows
and need one action per note; Daily is either a list of notes or a second paste. The owner's model:

1. **Notes are input only.** One note may hold several topics; several notes in a day may feed the same one.
2. **The harness derives Tasks from the notes' context.** The derived information is what the owner faces, not the notes.
3. **Daily = the Tasks due today**, plainly listed. It is computed on the device: no second paste.
4. **Questions stay one at a time, one reply each** (owner correction, 2026-10-11: no answer sheet). They are the visible
   signal of how the harness isolated a topic: a question that shows a wrong split is the owner's chance to correct its
   scope and context in the reply ("these are two things", "this belongs with the bulb task"). The action count drops
   because questions are asked per topic, not per note.
5. **An owner edit of a registered Task (or a Task added by hand) re-enters the next run** to be re-evaluated.

**Proposed decisions (none accepted yet):**

| # | Proposal | Replaces |
|---|---|---|
| P1 | The harness creates **Task** records directly (VOCABULARY "Task"); the owner edits, completes, carries or drops them. No accept-a-hook step | D-39 (Task only on accepting a hook), D-34's "nothing extracted" for tasks; H4 is pulled into HW |
| P2 | **One paste per run.** The harness output gains task operations; Daily needs no stage-2 call. The AI journal (stage 2) stays optional ("Summarize") | D-60's two-round-trip shape for the daily loop |
| P3 | Questions are keyed to the Task (topic) they isolate (`taskId`), else to the note, and shown with that Task's text so the split is visible. Answered one at a time, as in S3a. **An answer is scope input:** it reopens its Task, and the next run may split, merge or re-scope it from the reply (`split` / `merge` ops below, proposals only) | per-note placement of questions in S3a (the one-reply-per-question mechanic stays) |
| P4 | `entryStates` stops being an owner surface: a note's life ends at "assessed". Dropping a junk note stays possible from the notes list | D-65/D-67 evening pass on notes (moves to Tasks) |

**Task record (new kind `task`, additive: Worker validator + D1 accept it before any client writes one).**

| Field | Meaning |
|---|---|
| `id` | uuid5(`runId` + normalized text) when the harness creates it (replay = no-op); uuid v4 when the owner adds one |
| `text` | one line, the task as the owner would say it |
| `sourceEntryIds` | every note that contributed (grows when a later note joins the same topic) |
| `due` | `YYYY-MM-DD` or null — only when a note implies it; a deadline also gets the lead-time question (D-66) |
| `state` | `open · done · dropped`, with `followUpOn` for a carry (Daily = open with `followUpOn ?? due ?? createdDay` ≤ today) |
| `by` | `harness · owner` — who wrote `text` last. **The model never overwrites owner text**; it may only propose |
| `editedAt` | last owner edit; **`editedAt` > the task's last assessment ⇒ the task is in the next run** (constraint 5) |
| `runId`, `createdAt`, `updatedAt` | provenance |

**Harness v2 input and output.** Input = new or reopened notes (as today) **plus the open Tasks with their ids, sources and
answered questions**. Output per run:

```ts
{ tasks: [
    { op: 'create', text, sourceEntryIds, due|null },                 // new topic
    { op: 'attach', taskId, sourceEntryIds, due?|null },               // a later note feeds an existing task (constraint 1)
    { op: 'close',  taskId, entryId, evidence },                       // proposal: a note says it is done (owner confirms)
    { op: 'revise', taskId, text?, due? },                             // proposal on a re-evaluated task; never applied over owner text
    { op: 'split',  taskId, into: [{ text, sourceEntryIds }] },        // proposal, usually from an answer that says "two things"
    { op: 'merge',  taskIds, text },                                   // proposal, from an answer that joins topics
  ],
  questions: [ { taskId|null, entryId|null, text } ] }               // ≤ 3 per task or note, as today
```

Validation keeps every S1 rule (candidate set, replay, stale run, dates, caps) and adds: `attach`/`close`/`revise` name an
open task that was in the prompt; `create` must cite at least one note from the prompt; a `create` whose normalized text
equals an open task's is turned into an `attach` (dedupe within the day).

**"Trigger a rerun" with the copy-prompt executor.** An edit cannot start a model call by itself: there is no API key
(D-63). An edit marks the task as waiting, and the questions strip shows **"N changes waiting for feedback"** with the Get
feedback button. A truly automatic re-run is H5 (API executor), whose re-entry is evidence: §7's paste count.

**Dashboard v2.** Top: questions strip, one question at a time with the Task it isolates shown above it, reply · skip · next, and a list view. Middle: **Daily** — today's Tasks with
done · tomorrow · drop, tap-to-edit text, "+ task". Bottom: notes (input history, "+ Today" removed).

**Open — each with the default I would proceed under:**
1. "Edit of an already registered daily summary" = editing a Task in Daily (or adding one) — *default yes*; the
   alternative is a stored free-text day summary the owner edits, which would then be a note-like input to the next run.
2. Do answered questions still reopen their note (S1 rule)? *Default: they reopen the task they belong to, else the note.*
3. The S3a records already in production (assessments, questions, links on 12 notes) stay valid; v2 reads them, nothing migrates.

**Slices.** S0 this section + VOCABULARY/DECISION rows on acceptance · S1 domain (`tasks.ts`, harness v2 compose/parse/apply,
pure, tests incl. dedupe + owner-text guard) · S2 Worker kind `task` + `questions.taskId` (additive, deployed first) · S3
Dashboard v2. The parked S3b branch (`feat/s3b-dashboard-loop`, local) gives the strip and day logic to reuse.
