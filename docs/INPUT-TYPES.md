# Input types (Design, ROADMAP Phase 2)

**Status: proposed (2026-11-22), ends in one owner question (§6).** The owner marked input types HIGH and said on
2026-11-22 to start it now, before R10 (D-142). INBOX `fe9a6102`, `b41e07d2`. Terms per [VOCABULARY.md](VOCABULARY.md).

## 1. What the planner takes today (code, 2026-11-22)

| Input | Limit and shape | Source |
|---|---|---|
| Note (Entry) | Plain text, **multi-line, up to 20,000 characters**, up to 20 tags, optional `occurredAt` | `src/domain/entry.ts:19`, capture box in `src/views/HomeView.vue` |
| Task | **One line, up to 200 characters** (whitespace collapsed); `due`, `followUpOn` | `src/domain/tasks.ts:12`, `records.ts:250`; edit field is a one-line `<input>` (`DailyCard.vue:203`), the add box grows |
| Answer to a Journal question | Up to 2,000 characters | `src/domain/harness.ts:10` |
| Free note to the Journal | A note, as above | `src/harness/FreeNote.vue` |
| Voice | No own recording. The phone keyboard's dictation types into any box; `submit.ts` keeps text dictated during a save | `src/capture/submit.ts:18` |
| Pictures, files | None | grep, no attachment code |
| Links | Plain text inside a note; not clickable, no preview | grep |
| Note kinds | One kind of note. Widgets have kinds; notes don't | `records.ts:236` |
| One synced record | At most 64 KB of JSON | `records.ts:48` |

**Correction.** INBOX `fe9a6102` (written earlier today) said "a note can only be short text". That's wrong: notes take
20,000 characters. The 200-character, one-line cap applies to Tasks. So the brief the owner couldn't paste on 11-10 was
pasted as a Task.

## 2. Two readings of "input types"

- **A. Formats:** new kinds of content in what already exists: longer Task text, pictures in a note, clickable links,
  maybe voice memos.
- **B. Note kinds:** typed notes, as in the work journal, where each type (for example a daily log, a meeting, a 1:1)
  has its own template, fields and handling in the Journal. The proposed "Window" item (`cb86a0d7`) is a typed item of
  this sort.

The two don't exclude each other, but they're different projects. Which one the owner means is his to say (§6).

## 3. Reading A, per format

### T1. Longer Task text (`b41e07d2`), size S–M

- **Change:** text the owner writes on a Task goes from one line of 200 to **multi-line, up to 1,000** characters. Text the
  model writes (`taskProposal.text`, `parts`, `basis`) stays one line of 200, so prompts stay tight and a model can't
  write long text into owner fields.
- **Readers to cover** (R5: every member of the class): the validator (`records.ts:250`, shared by the Worker through
  `api/src/records.ts`), `tasks.ts` add and edit, the DailyCard edit field (`<input>` → growing `<textarea>`), the
  harness prompt (`harness2.ts:164` fences the text, so prompt bytes grow), the Summary lens, Send as issue (an issue
  title is ≤ 200, so a long Task becomes title = first line, body = the rest), the export, and the desktop readers
  (`commitments.py`, notes-intake).
- **Older builds:** an older device drops a pulled row its validator refuses, and doesn't pull it again. A 300-character
  Task would vanish there. Fix: the Worker deploys first, the app bumps `REPULL` 2 → 3 (`src/sync/engine.ts:20`), so each
  device fetches the rows again once it updates. The G2 mechanism, reused.
- **Owner validates:** paste a multi-line brief as a Task on the phone; it shows whole on the PC; the Morning run reads
  it.

### P. Pictures in a note, size L

- **Storage:** binaries don't fit a 64 KB record or a D1 row. **Cloudflare R2** (free tier 10 GB; enabling R2 is an
  account setting, so the owner does it). Key `user/<id>/<attachmentId>`, served only through the Worker with the
  session check, never a public bucket.
- **Device:** pictures shrunk on the phone before upload (longest side ~1600 px, WebP, ~200–400 KB); kept in IndexedDB
  until uploaded, so capture works offline; uploaded apart from the record sync.
- **Data:** an Entry gets `attachments: [{ id, mime, bytes, width, height }]` (added field, older builds keep working).
  That is a Dexie version bump, so the rule "never roll Pages back past a Dexie version bump" applies, and it needs a D1
  migration.
- **Model:** pictures are **not** sent to the model by default (cost, and a second kind of data leaving). A later
  per-lens opt-in.
- **Export:** the local pull lists attachments; binaries come by a separate read.
- **Notice:** R10 must say where pictures are stored.
- **Owner validates:** shoot a picture into a note on the phone, see it on the PC, delete the note and the picture is
  gone from R2.

### L. Clickable links, size S

URLs in a note render as links (no fetching). Previews are left out: a Worker that fetches arbitrary URLs is an SSRF
surface.

### V. Voice memos: not proposed

The keyboard's dictation already covers speech to text. A recording needs either a transcription model on the user's
key or the browser's speech service (audio goes to the browser vendor). Revisit if dictation falls short.

## 4. Reading B, in brief

A `noteKind` per Entry (null = plain), each kind a small template (headings to fill in) and an optional effect on the
Journal (a meeting note asks for actions, a daily log feeds Summary). Window (`cb86a0d7`) would be one kind with an end
date and an end rule. Size M per kind after an L foundation. It needs its own design doc, starting from which kinds the
owner writes in practice.

## 5. Order (reading A)

T1 → P → L. T1 first: the owner already hit the limit, it needs no new infrastructure, and it proves the REPULL path
for P.

## 6. Owner question

**Q1.** Which input types, in what order?

- **(Recommended) Reading A: T1 longer Task text → P pictures → L links;** no voice memos.
- Reading B: typed notes (with Window as one kind); A waits.
- Both: T1 now, then the B design before P.

Proceeding under the recommendation: T1 starts in the next session turn, since it comes first in every option.
