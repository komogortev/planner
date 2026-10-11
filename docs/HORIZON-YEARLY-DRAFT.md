# Horizon loops — the yearly loop (DRAFT)

**Status: draft 2026-10-11. Nothing here is decided and no code follows from it.** Terms per [VOCABULARY.md](VOCABULARY.md); *Horizon* and *Goal* are proposed terms with no row yet (VOCABULARY rule: the row comes before the code). Premise: [HW-HARNESS.md](HW-HARNESS.md) §10 C5 — a horizon above weekly reads the **reports** of the horizon below, not raw notes.

## 1. Where the pattern comes from

The owner's other journaling tool has a yearly artifact. It was read on 2026-10-11 to check the claim that it is "the yearly horizon". What it holds, at pattern level (nothing of its content or rubric belongs in this public repo):

- **One annual-review entry per year**: per criterion a self-assessment text, another party's text, and a 1–4 rating.
- **Declared goals kept apart**, as a reference entry the AI reads — not inside the review entry. *Not read*: that entry lives in the tool's database; what it contains is unverified.
- **A goals card on the home page** that a scheduled job rewrites **only when it is stale** (the model answers `shouldUpdate: false` otherwise).
- **A period review** over any window: per criterion a status (strong · ok · weak · none) with cited entry ids, plus wins, blind spots, open loops, at most three recommendations, three focus items.
- **Evidence tagged per entry at capture** (strength 1–3 per criterion), which the yearly view aggregates.

| Piece | Transfers to the planner? |
|---|---|
| The loop shape: declare goals → accumulate evidence → periodic review → year-end self-assessment | **Yes** — this is the equivalence, and it holds for the shape only |
| The criteria, levels and rating scale | **No** — set by an employer. The planner's criteria are the owner's own declared goals |
| The other party's text and the rating | **No** — a performance-management artifact. The yearly report is the owner's self-assessment; the AI's view is `ai-observation`, never a rating of the owner |
| Evidence tagged per entry at capture | **No** — capture is typeless (D-07) and hooks are found at run time (D-34). Evidence is found at run time, in **per-goal lines inside each lower report** |
| A scheduled job calling an API | **No** — copy-prompt (D-63). One part transfers as code, not as a prompt: *no new lower report since the last yearly report → no copy at all* (the same rule as an empty slice) |

## 2. Inputs

All from the signed-in account's on-device copy; the run header says how many reports and goals will leave the device.

1. **Goals** — owner-authored text for one calendar year, each with a stable id `g1…gN`. Storage is open (Q1).
2. **The monthly reports of the year to date**, oldest first, each with its id, its window, its per-goal lines and the entries it cited.
3. **The previous yearly report**, if any, so the new one can say what changed.

No raw notes. A report enters only if it is stored, immutable, and from this account.

## 3. Output (strict JSON; anything else is refused with the reason shown)

```ts
interface YearlyReport {
  headline: string                       // one sentence verdict for the period
  summary: string                        // one short paragraph
  goals: Array<{
    goalId: string                       // must be one of the input goals; each exactly once
    status: 'strong' | 'ok' | 'weak' | 'none'
    trend: 'up' | 'flat' | 'down' | 'unknown'
    comment: string
    evidence: Array<{ reportId: string; entryId?: string; quote?: string }>
  }>
  wins: Array<{ text: string; reportIds: string[] }>            // ≤ 5
  blindSpots: string[]                                          // ≤ 4
  openLoops: Array<{ text: string; reportId: string }>          // ≤ 5
  proposals: Array<{ kind: 'revise-goal' | 'drop-goal' | 'add-goal'; goalId?: string; text: string; why: string }>  // ≤ 3
  focusNext: string[]                                           // ≤ 3
}
```

**Validation before storing** (pure, like `validateReport`): every `reportId` is in the inputs; an `entryId` or `quote` is kept only if *that report itself* cites it (citations are transitive, never invented upward); a goal missing, repeated or unknown → refused; counts over the caps are cut and counted; `proposals` are stored as proposed and only the owner's tap changes a goal (the AI reads, reports and proposes); the report is immutable, a second reply for the same run is refused.

## 4. The prompt (draft)

Built by the one composer (A2); the report language comes from settings, never from this text. `{…}` marks what the composer fills.

```text
You review one person's year against the goals they declared. You receive their
goals (each with an id), the monthly reports of the year so far (each with an id and
its own evidence per goal), and last year's yearly report if one exists.

Rules:
- Use only what the reports say. Cite report ids exactly as given; cite an entry id or
  quote only if that same report cites it. Never invent an id or a quote.
- Be calibrated. Routine upkeep is not progress on a goal. Status per goal:
  strong = several clear examples across more than one month; ok = at least one clear
  example; weak = only hints; none = nothing. Say none when there is nothing.
- A goal with no evidence is a finding, not a gap to fill. Do not stretch an unrelated
  win to cover it.
- Separate the person's own actions from things that merely happened to them or were
  reported about others.
- Trend compares the last third of the period with the first two thirds; unknown
  if there are fewer than three months of reports.
- Blind spots: goals with no evidence, and recurring effort that serves no declared goal.
- Open loops: commitments that appear in one report and are never closed in a later one.
- Propose a goal change only when two or more reports point the same way. A proposal is
  a suggestion for the owner to accept or reject; give the reason in one line.
- Recommendations must be doable in the next month. At most 5 wins, 4 blind spots,
  5 open loops, 3 proposals, 3 focus items. Keep every item short.

Return only JSON in this shape, with every goal exactly once:
{shape}

Goals ({n_goals}):
{goals}

Previous yearly report: {previous_or_none}

Monthly reports, oldest first ({n_reports}):
{reports}
```

## 5. Open points — each with the default I would proceed under

| # | Question | Default |
|---|---|---|
| Q1 | Where declared goals live. (A) a record kind `goals`, one per year, owner text, state `open·achieved·dropped`; (B) a settings text field; (C) a pinned Entry | **(A).** Additive on `records` (HW-HARNESS §5), the owner's own text, ids stay stable for citation (never delete and re-create under one id). (C) would put a document in a stream built for notes |
| Q2 | Monthly reports do not exist; the daily widget is the only built loop. Order | daily → weekly → monthly → yearly. Before any code, **trial the yearly prompt by hand** over exported notes (the H2 trial pattern), to learn whether the owner keeps it |
| Q3 | Window | calendar year to date; the same prompt run in June is a mid-year check |
| Q4 | A life-goal horizon above the yearly one | a standing declaration each yearly goal may cite (`lifeGoalId`); its own loop only if the yearly reports show drift against it |
| Q5 | Goals are personal data sent to a model | shown in the run header with the count; clipboard rules as D-54; no goal text in fixtures (synthetic only) |
| Q6 | Per-goal lines are required in every monthly (and weekly) report for this to roll up | yes — amend the weekly/monthly report shape when those specs are written; without them the yearly loop has nothing to aggregate |

## 6. Not verified

That the monthly reports will carry enough per-goal evidence to support a yearly review (nothing exists to measure); whether the owner keeps a yearly review at all (no trial run); the contents of the other tool's declared-goals entry.
