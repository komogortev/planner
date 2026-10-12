# Planner — decision tree (roadmap planning, draft)

**Status: accepted by the owner as the roadmap basis, 2026-10-10.** Rulings are in §4a; the docs pass that carried
them into PROJECT, VOCABULARY, ARCHITECTURE, H1-ENTRIES and STATE is recorded in the PROJECT decision log. Defaults
in §6.2 the owner did not contradict carry as accepted until contradicted. Terms per [VOCABULARY.md](VOCABULARY.md); invariants per
[ARCHITECTURE.md](ARCHITECTURE.md) (A1–A12). Decision ids `D-nn` are stable: never renumber, retire with a line.

## 1. Frame — how to read this

The tier plan (H1 → H5) says **what ships in what order**. It does not say **what a user can do at each moment and what
each branch costs**. This tree walks the user's actions, and at every fork names the technical decision behind it.

- **Trunk** (§2) — decisions already taken that every branch inherits. Reopening one is a decision-log entry.
- **Action branches** (§3) — one tree per user action: the paths, the failure/offline forks, and the `D-nn` each fork needs.
- **Register** (§4) — every open decision once: options, `(Recommended)`, what it gates, the check that settles it,
  and its re-entry condition.
- **Critical path** (§5) — which decisions block which build, in order.
- **Gaps** (§6) — forks the written docs do not cover at all (the most valuable output of this pass).

Status tags: ✅ settled (cite) · ◻ open (in a doc) · ⚠ gap (in no doc).

## 2. Trunk — settled, inherited by every branch

| # | Decision | Source |
|---|---|---|
| T1 | Local-first: capture and browse with zero network; sync is additive | PROJECT constraints, A10 |
| T2 | One backend: Cloudflare Worker + D1, $0 first, $5 plan allowed; no other hosted service without a log entry | PROJECT 2026-10-09 |
| T3 | Invite-only multi-tenant accounts, Google/GitHub sign-in, bearer token in IndexedDB, own OAuth code + Hono | H1 Q1, §8 |
| T4 | Server orders changes (`server_version`); replaced bodies kept as revisions; soft deletes travel as rows | A12, H1 §6.3 |
| T5 | AI never edits an entry; AI output = Report / Proposal; owner accepts | A1, A6 |
| T6 | Backend may read content (no E2E); owner copy = nightly export to private repo | PROJECT 2026-10-09 |
| T7 | `domain/` is environment-free so browser and Worker share cleaning, slice, composer | ARCH §3 |
| T8 | Phone (Android) primary, desktop secondary; 3-page pager Home · Dashboard · Settings, no wrap | notes 7–9, #25 |
| T9 | Vibe-code: Claude decides architecture; money / publishing / irreversible deletes go to the owner | log 2026-10-10 |

## 3. Action branches

Notation: `→` happy path · `├` fork · `[D-nn]` the decision that fork needs · ✅/◻/⚠ status of that fork.

### 3.1 Open the app

```
launch
├ not signed in → gate (photo + ring) → provider dialog
│   ├ Google ──┬ invited Gmail/Workspace → account → home                         ✅
│   │          └ invited non-Gmail → cannot redeem via Google; must use GitHub    ✅ known limit [D-03: tell invitee how?]
│   ├ GitHub (PKCE) ── verified email invited → home                              ✅ (real sign-in unverified on prod)
│   └ no invite → rejected screen: what does the person see and can they request one?  ⚠ [D-03]
├ signed in, online → home
├ signed in, offline → home from cached token                                    ✅ T1
│   └ token expired while offline → keep working locally, re-auth on reconnect;
│     outbox must survive re-auth                                                ⚠ [D-04]
├ opened in browser tab vs installed app → install prompt, sign-in return        ◻ iPhone deferred (H1 Q2)
└ update available → banner → reload; Dexie/outbox survive the SW swap           ✅ shipped; phone check open
```

### 3.2 Capture (the core action)

```
home (dictophone)
├ type text → Capture
│   ├ empty / > 20,000 chars → refuse, write nothing                              ✅ A10
│   ├ ok → entry + outbox row, one transaction                                    ✅
│   └ app killed mid-typing → unsent draft lost?                                  ⚠ [D-05 draft persistence]
├ speak → speech-to-text only, no audio kept                                      ✅ (note 13)
│   ├ engine?                                                                     ◻ [D-06]
│   ├ offline → does voice work at all?                                           ◻ [D-06] (cloud engines need network)
│   └ recognition wrong → text lands in the window, owner edits before Capture    ⚠ [D-06]
├ capture carries intent? ("expressing one action/intent", note 11)               ⚠ [D-07 typed vs typeless capture]
│   ├ plain note
│   ├ task / promise ("I told X I'd …")  ── when does it become a Task?           ◻ H4
│   └ reminder with a time ("tomorrow 9") ── who parses the time, what fires it?  ⚠ [D-07, D-16]
├ capture from outside the app (Android share sheet, text selection, shortcut)    ⚠ [D-08 share target]
│   └ shared image / file / link title → attachment? → blob storage              ⚠ [D-09 attachments]
├ set category / tags / event date at capture?                                    ◻ H1b — default: never blocks, Inbox
└ capture confirmation: LED flash, "N not synced yet" = outbox size               ✅
```

### 3.3 Sync (invisible, but every user path forks here)

```
trigger: start · visible · online · 2 s after capture · 60 s while visible        ✅ H1 §6.4
├ background while app closed (Android Background Sync)                           ◻ [D-10]
├ push ≤ 50 mutations / 100 KB
│   ├ ok → outbox rows cleared, cursor advances
│   ├ 429 → back off, honour Retry-After                                          ✅
│   ├ 401 → re-auth without dropping the outbox                                   ⚠ [D-04]
│   ├ replayed push → same result, one entry                                      ✅ A10/idempotent
│   └ edit on A, edit on B → server orders, loser's body → revisions              ✅ T4
│       └ does the loser ever SEE their replaced text? (revision viewer)           ⚠ [D-11]
├ pull ≤ 100 rows after cursor; second device appears                             ✅
├ live updates while both devices open (poll 60 s vs push channel)                ◻ [D-12]
├ storage: quota / persist() / usage in Settings                                  ✅ planned S3
└ failure surface: status pill, last error, manual "sync now"                     ◻ S3 UI — what does the owner see when sync is stuck?  [D-13]
```

### 3.4 Browse, find, edit, delete

> **Owner ruling 2026-10-10:** browsing is a **widget**, not a screen (D-14 list, D-15 search; system widgets if the
> widget model can express them). Deferred past the vertical slice. The tree below stays as the list of forks that
> widget must answer. Widget model: D-30.

```
entries list (no screen yet — S3 lists "entries list")                            ⚠ nothing specifies the screen
├ order / grouping: capture time vs event date; day headers                       ⚠ [D-14]
├ find: text search
│   ├ local Dexie scan (offline, full copy on device)                             ◻
│   └ server /entries?q= (LIKE ≤ 50 B pattern; FTS5 later)                        ◻ H1 Q7  [D-15]
├ filter: category · tag · date · unsynced                                        ◻ H1b / H2 slice reuse
├ edit body → revision on server; "edited" marker                                 ⚠ [D-11]
├ delete → soft, confirm; undo window? purge after 30 d?                          ◻ H1 Q4
└ bulk select (categorise, tag, delete)                                           ⚠ [D-14]
```

### 3.5 Organise (H1b)

> **Owner ruling 2026-10-10: H1b is doubtful.** Categories, tags, Inbox and rules are built only if AI working on
> prompts shows they are needed. Until then they are not scheduled. The tree below is parked, not deleted.
> Consequence: D-19's "stop at H1b" fallback no longer holds — the fallback is H1 plus widgets.

```
Inbox triage
├ assign category (single) · add tags (many)                                      ◻ H1b
├ category rule edit ("how to read entries here")                                 ◻ H1b
├ create / rename / delete category on device A while device B uses it
│   └ delete-in-use is refused locally; across devices it can still race          ⚠ [D-17]
├ rename cascade: entries hold id, label is display only                          ✅ (ids)
└ AI-proposed categories/tags → Proposal queue                                    ◻ H3/H4
```

### 3.6 Dashboard (page 2)

> **Mostly answered by the rulings in §4a (D-18, D-31).** Activation is a setting on the widget itself; a widget is one
> instance and a different use is a clone. Widgets are per account (D-31a). Still open: what "version" means for a
> clone (copy-on-clone, or a lineage link to the original), and whether the Dashboard order is a widget setting too.

```
dashboard = "list of activated widgets" (note 8)                                  ⚠ undefined everywhere
├ what is a widget?
│   ├ a saved lens result (H2)       ← shares the Report model
│   ├ a built-in live view (Inbox count, unsynced count, today's entries)
│   └ a third-party / custom module
├ who activates one, where is the activation stored (settings, synced?)           ⚠ [D-18]
└ empty state until H2: what does the page show?                                  ⚠ [D-18]
```

### 3.7 Lenses (H2)

```
trial first: Claude Code over the nightly export, two weeks, read-only            ✅ H2 §7
├ keep ≥ 1 lens → build domain (slice, composer, validator)
├ nothing kept → H2 stops; what is the helper then?                               ⚠ [D-19 kill criterion]
run from the app
├ executor claude-code (via H3) · copy-prompt fallback · app (H5)                 ◻ H2 §7
├ empty slice → no model call, report says so                                     ✅
├ prompt too large → truncate oldest, header says so                              ✅ Q7
└ citation outside slice / proposal kind not allowed → dropped, flagged           ✅
```

### 3.8 Agent surface (H3) and proposals (H4)

```
Claude (desktop / phone app) connects to remote MCP on the Worker
├ MCP OAuth: owner approves a client; scopes (read · run · propose)               ◻ H3 S0   [D-20]
├ token revoke / list connected clients (Settings)                                ⚠ [D-20]
├ tool call → audit row; destructive tools never registered                       ✅ A5/A6
├ proposal arrives → queue in app → accept / reject / edit-then-accept            ◻ H4
│   └ accepted proposal on device A, edited entry on B                            ⚠ [D-17] same race class
└ Task state machine: open · doing · done · dropped; promise / waiting            ◻ H4
```

### 3.9 In-app AI and notifications (H5)

```
scheduled lens with no session open
├ whose API key, whose money? (multi-tenant: invitee runs cost the owner)         ⚠ [D-21 cost envelope]
├ scheduler: Worker Cron Triggers (free-plan count and granularity)               ◻ [D-16]
├ notification: Web Push (VAPID, payload encryption on a Worker)                  ◻ [D-16]
│   └ capped per day, silent by default, global pause                             ✅ A8
└ model gate callAI(featureId): model/effort from settings                        ✅ A7
```

### 3.10 Account lifecycle

```
├ invite → redeem → first sign-in                                                 ✅ (script; no email mechanism, revisit at tester #4)
├ list my devices / sessions, sign out everywhere                                 ⚠ [D-22]
├ export my data (per user)                                                       ◻ H1 Q6 — GATE before the first invitee's entries flush
├ delete my account (data + sessions + revisions)                                 ◻ H1 Q6 — same gate
├ owner reads an invitee's entries? (backend can; policy and wording)             ◻ H1 Q6 "tell the tester in writing"
├ invite expiry / revoke                                                          ✅ expiry; revoke ⚠ [D-22]
└ owner-only: frozen financial export + deletion                                  ◻ owner's explicit go
```

### 3.11 Cross-cutting (no single user action)

| Fork | Status |
|---|---|
| Client host moves to own `*.pages.dev` origin at S4; OAuth origins and CSP follow | ✅ Q8 amended |
| Version badge in prod after cut-over | ◻ re-entry S4 |
| Time zone and language (composer reads language from settings; windows need a zone) | ◻ H2 Q2; no Settings field yet ⚠ [D-23] |
| Error / crash reporting from the phone (public repo, free tier) | ⚠ [D-24] |
| Real-device test routine (pager vs scroll, keyboard over dictophone, gate sign-in) | ⚠ [D-25] |
| Nav reveal vs swipe, and Android gesture-bar conflict (note 10 open point) | ◻ shell built; phone check open |
| Accessibility of a gesture-only, art-driven shell (screen reader, reduce-motion) | ⚠ [D-26] |
| Data growth: D1 5 GB, rows-read/day, entry eviction trigger (50 MB) | ✅ deferred with trigger |

## 4. Decision register

`(Recommended)` marks the option I would take. "Settle by" is the cheapest check that decides it (R3), not a debate.

| ID | Decision | Options | Recommended | Gates | Settle by | Re-entry |
|---|---|---|---|---|---|---|
| D-03 | Invite UX: what a person sees with no invite / with a non-Gmail invite | (a) plain "ask the owner" screen · (b) request-access form storing an email · (c) status quo | **(a)** | first invitee beyond the tester | read the current post-OAuth failure path in `consumeReturn.ts` | before S3 ships to the tester |
| D-04 | Token expiry while holding an unsynced outbox | (a) silent renew with refresh · (b) block capture until sign-in · (c) keep capturing, re-auth banner, flush after | **(c)** | S3 `sync/` loop | write the 401-during-push test first (known positive) | S3 design |
| D-05 | Unsent draft persistence | (a) none · (b) autosave textarea to IndexedDB, restore on open | **(b)** (small, removes a data-loss path the capture promise implies) | S3 or a polish PR | kill the app mid-typing on the phone | any time |
| D-06 | Speech-to-text engine | (a) browser Web Speech API (Chrome Android sends audio to a Google service; needs network) · (b) on-device recognition where the browser offers it (**verify** availability on the owner's Android Chrome) · (c) backend STT (Workers AI; free-tier neurons; audio leaves the device to our Worker) · (d) keyboard dictation only, no in-app engine | **(d) now, (a) as an enhancement** — zero new infra and works wherever the keyboard does; revisit if the owner wants an in-app mic button | the dictophone's record-key meaning | measure: does the Android keyboard's mic already fill the cassette textarea acceptably? | next capture polish |
| D-07 | Typed vs typeless capture | (a) typeless entry; classify later by rule/AI · (b) intent chooser at capture (note / task / reminder) · (c) typeless + light parse of an explicit prefix ("todo:", "remind:") | **(a) for H1/H1b; (c) at H4** — keeps A "capture never blocks" and `Task` stays a later record | H4 Task model, H5 reminders | owner check: does he want to choose at capture? His note 11 reads "one action/intent" — ask once | before H4 S0 |
| D-08 | Android share target (receive text/URL from other apps) | (a) skip · (b) `share_target` in the manifest → capture prefilled | **(b) after sync works** — largest capture-friction win on a phone; text-only | after S3 | manifest support check on installed PWA | after S3 |
| D-09 | Attachments (images, files) | (a) never · (b) later, R2 object storage | **(a) until D-08 text share is used for a month** — R2 is a second hosted service (needs T2 log entry) and puts blobs into the eviction budget | only if a real need appears | count how often he wants to share a non-text item | 50 MB local-usage trigger or first request |
| D-10 | Background sync while the app is closed | (a) none: foreground triggers only · (b) Background Sync API one-shot (Android Chrome) | **(a) for H1; (b) as additive** — the exit week can run on foreground triggers; cost is small later | exit-week experience | exit week: how often does he reopen to find unsynced items? | S5 |
| D-11 | Revision viewer: can an owner see replaced bodies | (a) never in UI (server keeps) · (b) "earlier versions" on an entry | **(b) at H1b** — otherwise "nothing is lost" is true but not observable | first real two-device edit conflict | inspect `entry_revisions` after the exit week | exit week |
| D-12 | Live updates across open devices | (a) 60 s poll · (b) WebSocket/Durable Object | **(a)** — Durable Objects are a second billed primitive; one user, two devices | none | exit week | invitee count > 5 or lens results pushed live |
| D-13 | Sync failure surface | (a) pill only · (b) pill + detail sheet (last error, outbox count, retry) | **(b)** | S3 UI | design in S3 | S3 |
| D-14 | Entries list contract (grouping, ordering, selection, empty states) | needs a mini-spec | **write `H1-S3-CLIENT.md` §list before building** | S3, H1b | — | S3 S0 |
| D-15 | Search scope | (a) local Dexie scan · (b) server `LIKE` · (c) D1 FTS5 | **(a) for H1** (full copy on device, works offline), **(c) when lenses need server slices** | H1b | measure local scan on N entries at 4 MB/yr | entries > ~10,000 or server lenses |
| D-16 | Scheduler + push for reminders/scheduled lenses | (a) Worker Cron + Web Push (VAPID) · (b) none, owner pulls | **decide at H5 S0; spike VAPID-on-Workers early** because reminders (D-07) pull it forward | H5 | spike: send one push from the Worker to the owner's Android PWA | before H5 S0, or when D-07 chooses reminders |
| D-17 | Cross-device semantic conflicts (category deleted vs assigned; proposal accepted vs entry edited) | (a) refuse server-side with a typed error and a client repair · (b) tombstone category, soft-delete only | **(b)** — consistent with T4 | H1b sync of categories | write the race as a worker test with two accounts' devices | H1b S0 |
| D-18 | Dashboard / widget model | (a) widgets = built-in live views only through H1b, lens reports join at H2 · (b) widgets = lens reports only · (c) plugin-style registry | **(a)** — an honest dashboard from H1 (unsynced, Inbox count, today); activation as a synced `settings` row | the page that already exists as a stub | owner: which 2–3 things does he want on that page *before* lenses exist? | before the next UI session |
| D-19 | H2 kill criterion | define now what "no lens kept" means | **If no lens kept after two weeks: stay at H1b (capture + organise) and park H3–H5** | investment in H3 | — | end of the lens trial |
| D-20 | MCP auth + client management | (a) per-client OAuth with scopes + revoke list · (b) one long-lived personal token | **(a)** — (b) cannot be revoked per client and is a leak risk on a public repo | H3 S0 | read the MCP authorization spec revision current at H3 S0 | H3 S0 |
| D-21 | Who pays for in-app model calls | (a) owner key, owner-only AI · (b) per-user keys · (c) none for invitees | **(c) → (a)**: AI features are owner-only until a billing story exists | H5 | — | first invitee asks for an AI feature |
| D-22 | Session and invite management | (a) SQL by hand · (b) Settings "devices" + owner admin page | **(b) minimal**: list/revoke own sessions; invite revoke stays a script | before invitee #4 | — | tester #4 |
| D-23 | Settings: time zone, language | (a) derive from device · (b) explicit setting | **(b)** stored in settings, defaulted from device | H2 windows | — | H2 S2 |
| D-24 | Error reporting | (a) none · (b) own `/log` route into D1 (capped) · (c) hosted service | **(b)** — no new vendor; cap by rate limit | S5 exit week | — | exit week start |
| D-25 | Real-device checklist | one file, run at every UI-affecting PR on the phone | **write `docs/DEVICE-CHECKS.md`** from the "not verified" list in STATE | confidence in shell work | — | next UI PR |
| D-26 | Accessibility baseline for the shell | (a) none · (b) reduce-motion honoured, labelled controls, keyboard path | **(b)** — cheap now, expensive after more gesture UI | H1b onward | one pass with TalkBack | before H1b |
| D-27 | A rejected mutation: skip and surface, or halt the queue | (a) skip + edit/discard · (b) halt | **(a)** — ruled | S3 | worker returns `rejected`; client test with a poisoned row at queue head | S3 |
| D-28 | Sign-out / clear data with a non-empty outbox | (a) block + count · (b) export first · (c) silent | **(a)** — ruled | S3 | test: outbox of 1 blocks sign-out | S3 |
| D-29 | First sign-in on a second device | (a) capture at once, paged pull with progress · (b) block until pulled | **(a)** — ruled | S3 | seed 500+ rows, capture mid-pull | S3 |

Ids start at D-03: D-01/D-02 were dropped while drafting (merged into D-18 and D-04) and are not reused.

### 4a. Owner rulings (2026-10-10, confirmed)

| ID | Ruling | Re-entry |
|---|---|---|
| D-03 | **Deferred.** Not a blocker: an alternative way exists | On the owner's request; if none, Claude reminds on arriving at the prerelease / test stage |
| D-05 | **Deferred.** A calibration-comfort feature, not valuable at least until release | Release |
| D-06 | **Deferred.** Voice needs its own evaluation session; not critical for the vertical slice | The voice evaluation session |
| D-07 | **Typeless capture is the default.** Capture is the primary goal; the automatic timestamp already carries much of the information, in the way a journal does, and can be leveraged. Reasoning kept with the ruling: hooks are not attached at capture; in H4 prompt-operating widgets collect hooks from the note's context, not from explicit marking by the user; manual sorting stays available as an option, not the default | H4 S0 (widget design) |
| D-08, D-09 | **Deferred, not blockers for the vertical slice** | After the vertical slice ships |
| D-04 | **(c)** keep capturing on 401; re-auth banner; flush the outbox after sign-in. Known positive: a 401-during-push test written first | S3 build |
| D-13 | **(b)** status pill plus a detail sheet (last error, outbox count, retry) | S3 build |
| D-27 | **(a)** a rejected mutation is skipped so the queue keeps moving; the row is kept, marked, shown, with edit or discard | S3 build |
| D-28 | **(a)** sign-out / clear-local-data is blocked while the outbox is non-empty, with a warning naming the count of entries that would be lost | S3 build |
| D-29 | **(a)** on a new device capture works at once; the initial pull runs in pages of 100 with a progress line | S3 build |
| D-10 | **Deferred** (foreground triggers only) | Not set |
| D-11 | **Yes, a revision viewer** — assigned to H1b, which is itself now conditional (below). Re-entry to be confirmed | H1b, if H1b survives |
| D-12 | **60 s poll** | — |
| D-13 (amended) | **Shape TBD.** Likely a one-time warning with an icon; exact location and decoration undecided. Supersedes "pill + detail sheet" until the UI session | UI session |
| D-18 (answered) | **Dashboard = the home for widgets the owner selected on a Widgets page.** Pager becomes four pages: Home · Dashboard · **Widgets** · Settings. Empty Dashboard shows an AddWidget button that swipes to Widgets. Empty Widgets shows a CreateWidget button plus the list of widgets, if any | Widgets design session |
| D-30 (new) | **Widget design needs its own session.** Open input: is the plain notes overview (table/list/stream) a default feature like capture, or a system widget? Leaning: system widget, and a good proof of concept for widget creation | Widgets design session |
| D-14, D-15 | **Entries list and search are widgets**, probably system widgets, if system features can be expressed that way. **Deferred to after the vertical slice** | After the vertical slice |
| D-31 (new) | **Widget activation lives in the widget's own settings** (no separate dashboard-membership record). **One widget = one instance**; using a widget differently **clones it into a new version**, a new widget | Widgets design session |
| D-31a | **Widgets are per account** (created on one device, present on all). Whether the "active" flag is also per account or per device: not stated, treated as per account until said otherwise | Widgets design session |
| D-32 | **Agreed (a):** widget = the surface; lens = the saved instruction inside a prompt widget; system widgets hold no lens. A clone copies the lens with a lineage link; a report records the lens version that produced it | Widgets design session |
| D-33 | **Agreed (a):** first slice = time window + free text + tags; no category filter and no category rules until H1b is justified | H2 S0 |
| D-34 | **Agreed (a):** hooks are found by the model at run time from the raw notes; no stored index | Trial evidence |
| D-35 | **Confirmed.** The trial runs in Claude Code over the nightly export with no app code; the first in-app executor is copy-prompt (Run builds the prompt via the one composer, owner pastes it into Claude and pastes the answer back, the app checks citations against the slice and stores an immutable report). MCP (H3) re-enters only on evidence that paste friction is why a lens goes unused; the in-app API key is H5 | Trial / first prompt widgets |
| D-14a (new) | **Vertical-slice list = a frosted-glass dialog on the Dashboard**, temporary, replaced by the notes widget. Proposed shape, not contradicted: newest first by capture time, flat stream with a day header per date in the settings time zone, row = time + first three lines + "unsynced" mark, no search/filter/edit/delete. The notes widget keeps this sort as default | Notes widget |
| D-36 | **Agreed:** prompt widget shows the last report with its age and a Run button; detail left to the widgets session | Widgets design session |
| D-36 (amended) | **The last report is cached per widget on the device and on the server, reaching the server on sync.** Recorded from the owner's message labelled "D-20"; read as D-36 (D-20 is MCP auth) — to be confirmed | Widgets design session |
| D-37 | **Agreed:** H3 is built only on evidence of paste friction, owner account only | D-35 evidence |
| D-38 | **Agreed:** a hook is accepted inline in the report in the widget; no proposal queue page until volume demands one | Prompt widgets |
| D-39 | **Agreed:** the Task record is built when a prompt widget shows hooks the owner wants to track; no reminders or notifications at that point | First prompt widget with hooks |
| D-40 | **Agreed:** chat dictation (add_entry) stays out of the first H3 | H3 exists |
| D-41 | **Agreed:** H1b-dependent terms (category rule, curation session, Theme and its UI, category/rule/theme proposals) are marked parked in VOCABULARY.md and the tier table, as a docs edit made later with the other widget vocabulary changes | The widget vocabulary edit |
| D-42 | **Agreed:** H5 is built only when widgets go stale for lack of a manual run | That evidence |
| D-43 | **Agreed:** hard monthly spend cap that stops runs, cost meter in Settings, cheap default model | H5 S0 |
| D-44 | **Agreed:** A11 is amended for scheduled runs: user id comes from the session **or** from a schedule row created by that user's own session. No cross-user system account | H5 S0; amend ARCHITECTURE A11 then |
| D-45 | **Agreed:** one digest per scheduled run, at most 2 a day, silent by default; no per-hook timers | H5 S0 |
| D-46 | **Agreed:** on failure keep the last good report, show an error mark, retry once, no notification | H5 S0 |
| D-47 | **Agreed:** schedules stored as local time + zone (needs D-23); an hourly Worker tick runs whatever is due; verify the free-plan cron limits when H5 starts | H5 S0 |
| D-16 (amended) | **The push spike moves from "early" to "after D-42 triggers"**; D-07 no longer pulls it forward | After D-42 |
| D-48 | **Agreed (a):** build `GET /me/export` (all account data as JSON) and `DELETE /me` with confirmation, plus two Settings buttons, **before the S3 client flushes entries**; they must cover every per-account table that exists then | Before S3 ships; tester invite expires 2026-10-24 |
| D-49 | **Agreed (a):** delete = hard delete of every row of the account at once; the notice states that D1 point-in-time restore retains old data for a time (verify the free-plan retention) and that the nightly export covers the owner's own entries only | With D-48 |
| D-50 | **Agreed (a):** sign-out (allowed only with an empty outbox, D-28) wipes the account's local tables and leaves the legacy financial tables; an "account deleted" signal (a typed 401) triggers the same wipe after offering an export | S3 build |
| D-52 | **Agreed:** Claude drafts a one-paragraph notice (what the owner can technically read, when the owner would, how to export or delete); the owner approves the wording and sends it | Before S3 ships |
| D-22 | Unchanged: list and revoke own sessions in Settings, before invitee #4 | Invitee #4 |
| D-53 | **Agreed (a):** no new page or table in the vertical slice; the four-page pager and the widget / lens / report schema come from the widgets design session | Widgets design session |
| D-54 | **Agreed (a):** copy-prompt clears the clipboard after a short timeout while the app is open; best effort, said so (Android clipboard managers and keyboards can keep history) | First prompt widget |
| D-55 (amends D-50) | **Accepted (owner, 2026-10-11, planner bug scan):** nothing deletes this device's notes except the owner's own gesture — sign out, "Clear this device", delete account. A server verdict (401, "account deleted") only changes what the banner says: it never wipes, and the launch-time `/me` check in Settings only displays. "Clear this device" names every note on the device (synced ones may be the only copy), saves a copy first (a copy that cannot be saved clears nothing) and re-checks inside the clear that the device still holds what was shown. Sign-out drops the token before it clears and ends the server session (best effort). Known positive: account deleted elsewhere + cold launch took 1 note to 0 with no banner | Hardening slice 1 |
| D-56 | **Accepted (owner, 2026-10-11: "implement recommendations and apply fixes"):** the text in the capture box is the owner's text. It survives a reload and a killed app (localStorage — synchronous, so `pagehide`-safe — saved when typing pauses and at once on pagehide / hidden / unmount; a blank box is nothing); it is shared between the app's windows (each keeps a belief about what is stored and corrects it from the other window's writes; a window with no edits of its own shows what the other saved; a capture empties another window only if it holds the captured text; a wipe takes every window's); and it is captured once (a second tap while writing is dropped; only the captured text leaves the box). Sign-out is refused for an unsent draft like for an unsent note (D-28); "Clear this device" names it and keeps it in the copy. Reproduced before the fix: a reload emptied the box, a double fire made two notes | Hardening slice 2 (#52) |
| D-57 | **Accepted (same):** a refusal on the OAuth callback (expired, cancelled, provider failure, no verified email, disabled, not invited, server error) is a redirect back to the app with `#error=<code>` — a fixed list; the nonce, the provider and at most three short addresses ride along — not a text page on the Worker's origin, which in an installed app has no way back. The app words it; the Worker's text is never shown; without a nonce only `expired` is shown. The `returnTo` read back from the flow cookie is parsed, then checked against the allow-list, and the parsed URL is followed — on the success path too (the raw-string check let `…/planner/../x`, `%2e%2e` and `..\` climb out of the allowed path; four forms reproduced). `/auth/start` errors, an unknown provider and a 429 stay as they were (reachable only by hand or by a flood). Smoke has a check for it | Hardening slice 3 (#51) |
| D-58 | **Accepted (same):** `GET /sync/pull` carries `head` (the account's newest version as of the read; absent when the account is not there). A device whose cursor is above it — or whose own **applied** push is given a version at or below its cursor (its pushes can bring `head` back up to the cursor before the pull looks; a `duplicate` proves nothing) — knows the server went back in time (a D1 restore, a hand-edited counter) and sweeps again from 0, once per cycle. The sweep is written down (`syncMeta.reconcile`) before its first request and cleared when it is done, so an interruption is finished by the next cycle; at the end, notes held here that the server did not return and that have no change waiting go back into the outbox (a deleted one as a delete) and upload in the same run. **Limits, named:** another device pushing past this cursor before this one pulls; a hand-edited counter set below `max(server_version)`. **Parked (re-entry: before an edit or delete UI ships):** an acknowledged edit or delete lost in a restore is not reconciled; `discardRejected` after a restore | Hardening slice 4 (#54) |
| D-59 | **Accepted (same):** the installed app and a browser tab each run their own sync engine over the same IndexedDB and share one token. The cycle runs under a Web Lock (`planner-sync`): windows take turns; a wait is given up after 30 s (the next trigger tries again); a request is cut off after 60 s so it cannot hold the lock; no Web Locks API, or a lock that cannot be taken → the cycle runs as it always did. The account the engine learned is remembered with its token and a cycle is pinned to the token it began with, so the old account's notes are never sent under another account's token (reproduced). A `storage` event on the token key resets the engine and the app follows (sign-in screen on sign-out; home when the window waited on the sign-in screen). **Parked:** a device clear that keeps the token (the foreign-account banner) is not announced to the other window — cosmetic, recoverable | Hardening slice 5 (#55) |
| D-60 | **Accepted (owner, 2026-10-11):** the first slice after H1 is the harness plus the Daily task journal widget, not the harness alone. Why: H1 delivers capture and sync but nothing uses the notes, so the exit week would measure a loop with no reason to run. Spec: [HW-HARNESS.md](HW-HARNESS.md) | HW-HARNESS S1 |
| D-61 | **Accepted (same):** two stages. Stage 1 (harness) marks each note once; stage 2 (widget) reads the marks. A widget re-run never repeats the assessment | HW-HARNESS S1 |
| D-62 | **Accepted (same):** questions, links, per-note state and assessments are separate tables; an Entry is unchanged and carries no AI text. The owner's answer is stored on its question row, not on the Entry | HW-HARNESS S2 |
| D-63 | **Accepted (same):** the executor for both stages is copy-prompt (D-35). No API key, no per-token cost; the owner sends the data. Paste count per day is recorded as the re-entry evidence for H3 (D-37) | HW-HARNESS S3 |
| D-64 | **Decided by Claude under vibe-code, 2026-10-11; the owner may reverse before release:** D-62's "separate tables" is kept on the device (one Dexie table per kind) but the server stores all seven kinds in ONE `records` table keyed `(user_id, kind, id)` with the fields as fixed-order JSON. Why: they share one push/pull protocol and one version counter, and the Worker queries nothing by field, so seven tables would copy the same sync, export and delete code seven times. An Entry is untouched either way | HW-HARNESS S2 |
| D-65 | **Accepted (owner, 2026-10-11), HW-HARNESS §10 C1:** S3 ships an **evening pass** — today's open notes and overdue carried ones, each with one tap: done · carry to tomorrow · drop. The calendar rule (§4) is unchanged; the pass is where the owner applies it. Why: an undone, uncarried note otherwise leaves the journal silently the next morning | HW-HARNESS S3 |
| D-66 | **Accepted (same), C2:** a due date written in a note's text gives a `followUp` to that day **and** one question asking which earlier day to pick it up; the answer sets `followUpOn`. No new field | HW-HARNESS S3 |
| D-67 | **Accepted (same), C3:** entry state `dropped` gets UI in S3, inside the evening pass; the harness never sets it | HW-HARNESS S3 |
| D-68 | **Accepted (same), C4:** daily windows run on capture date and `followUpOn`, never on `occurredAt` (no captured note has one; capture is typeless, D-07) | HW-HARNESS S3 |
| D-69 | **Accepted (owner 2026-10-11), HW-HARNESS §11:** Tasks are stored records (kind `task`) the harness derives from notes; notes are input only. Supersedes D-39's accept-a-hook gate and pulls H4 into HW | HW-HARNESS S3 v2 |
| D-70 | **Accepted (same):** questions one at a time, one reply each, keyed to the Task they isolate; a reply may re-scope (split/merge) and may grow into a thread on that Task; no answer sheet | HW-HARNESS S3 v2 |
| D-71 | **Accepted (same):** Daily has an editable summary; saving matches it against today's Tasks (edit · add · remove); edited/added Tasks enter the next run | HW-HARNESS S3 v2 |
| D-72 | **Direction (same), assessment pending:** re-run on edit automatic by default, owner may switch to manual to save tokens; needs the API executor (H5), so manual until then | After S3 v2 domain |
| D-73 | **Accepted (owner 2026-10-11):** removing a line from the daily summary carries its Task to tomorrow and queues a question on it (drop, or keep for later); nothing is dropped until the owner confirms. The app writes that question at save time | HW-HARNESS S3 v2 |
| D-74 | **Decided by Claude under vibe-code, 2026-10-11 (S3 v2 S1); the owner may reverse before release:** question and assessment rows are about a Task **or** a note, exactly one (`entryId` becomes nullable, `taskId` added); a question carries `kind: harness · removal`; the harness's close · revise · split · merge are their own kind **`taskProposal`**, proposed once (§11 named the ops but no record). S3a rows read as note rows, nothing migrates. Why: one question table and one assessment table keep a single queue and a single "waiting" rule for notes and Tasks | Worker S2, deployed before the client |
| D-75 | **Decided by Claude (same):** a `create` dedupes against **any** open Task, not only today's; a `create` may carry a `ref` so a question in the same reply can land on the new Task; notes S3a already assessed are re-read once by v2 if captured in the last 7 days (they get their Tasks, the old backlog does not); a confirmed split drops the original, a confirmed merge keeps the oldest Task (its questions stay its thread); confirming is refused once the owner edited a named Task after the proposal | S3 Dashboard v2 |
| D-76 | **Decided by Claude (same), D-73 mechanics:** the removal question answers by two taps (Drop it · Keep it for later) or free text; only "Drop it" drops; one open removal question per Task; its id is per removal, so a second removal the same day never overwrites an answered one | S3 Dashboard v2 |
| D-23 (amended) | **Agreed (a):** the vertical slice derives the time zone from the device; the explicit setting arrives with H2 windows | H2 S2 |
| D-24 | **Agreed (b):** own capped `/log` route into D1 on the existing rate limit; error type, route and build id only, never entry text | Before the exit week |
| D-25 | **Agreed:** write `docs/DEVICE-CHECKS.md` from the "not verified" list in STATE, run on the phone at every UI-affecting PR | Next UI PR |
| D-26 (amended) | **Agreed:** accessibility baseline (reduce-motion, labelled controls, keyboard path, one TalkBack pass) re-enters before the widgets page UI is built, not "before H1b" | Widgets page UI |
| S4 (2026-10-11) | **Nightly export cron deferred** (owner: manual export + D1 Time Travel suffice for the vertical slice). **Version badge stays.** **Client origin move: its own session, before the exit week.** `/log` (D-24) and DEVICE-CHECKS (D-25) built | Export: proposed re-entry before the first invitee beyond the tester or on request; origin move: before the exit week |
| H1b | **Doubtful.** Whether categories, tags and Inbox are needed depends on how well AI working on prompts performs; that result defines the need | AI-on-prompts evidence |


Effects of the rulings: hooks come from note context, so reminders do not arrive at capture and D-16 (push) is no
longer pulled forward; H1b is conditional on AI-on-prompts evidence; H3, H5 and the Task record are each built only on
named evidence (D-37, D-42, D-39).

## 5. Critical path (rewritten 2026-10-10 after the rulings)

### 5.1 The vertical slice — the only dated, unconditional path

Slice = capture on one device → sync → shown on a second device in a frosted-glass Dashboard dialog (D-14a).

```
BEFORE S3 SHIPS (dated: tester invite expires 2026-10-24)
  D-48/D-49  GET /me/export + DELETE /me + two Settings buttons   (cover every per-account table that exists then)
  D-52       notice drafted by Claude, wording approved and sent by the owner

S3 CLIENT                                                        known positive first
  sync loop    D-04 keep capturing on 401, re-auth banner, flush after       401-during-push test
               D-27 rejected mutation skipped, kept, shown (edit/discard)     poisoned row at queue head
               D-29 new device: capture at once, paged pull with progress     500+ rows, capture mid-pull
               D-10 foreground triggers only · D-12 60 s poll
  sign-out     D-28 blocked while the outbox is non-empty (names the count)   outbox of 1 blocks sign-out
               D-50 wipe account tables on sign-out / "account deleted"; legacy tables stay
  surface      D-14a Dashboard dialog, newest first by capture time, device zone (D-23)
               D-13 one-time warning with icon — shape TBD in the UI session

S4 CUT-OVER   financial screens out of nav · Worker + pages.dev origin · nightly export cron · owner account seeded
              · decide whether prod keeps the version badge · D-24 /log route (before the exit week)
              · D-25 DEVICE-CHECKS.md written and run on the phone

S5 EXIT WEEK  daily real use; H1 acceptance §1 checked item by item
```

### 5.2 After the slice — branches that start from evidence, not from a date

```
design only, may run alongside the exit week
  WIDGETS DESIGN SESSION   agenda, in order:
    1 widget model: system widget vs prompt widget; one instance, clone with lineage link (D-30, D-31, D-31a, D-32)
    2 notes widget as the proof of concept: list + sort + search (D-14, D-15)
    3 the four-page pager, the widget / lens / report schema and sync, vocabulary rows (D-53, D-41)
    4 accessibility baseline before the page UI is built (D-26)

needs the nightly export + ~1 week of real entries (the exit week supplies it)
  LENS TRIAL (Claude Code, no app code, ~2 weeks, read-only)          ── D-33, D-34, D-35
        │ evidence: does the AI help on raw timestamped notes?
        ├─ yes → prompt widgets with the copy-prompt executor (D-35, D-36, D-54)
        │          ├ hooks worth tracking      → Task record, inline accept (D-38, D-39)
        │          ├ paste friction blocks use → H3 MCP, owner account only (D-37, D-20)
        │          ├ widgets go stale unrun    → H5 scheduled runs (D-42..D-47, then the D-16 push spike)
        │          └ AI needs categories/tags  → H1b (D-17), then the revision viewer (D-11)
        └─ no  → fallback = H1 + system widgets (assumed; D-19 awaits the owner's confirmation)
```

### 5.3 Deferred with a named re-entry

| ID | What | Re-entry |
|---|---|---|
| D-03 | Invite UX for no-invite / non-Gmail | The owner asks; else Claude reminds on arrival at prerelease / test stage |
| D-05 | Unsent-draft persistence | Release |
| D-06 | Voice input engine | A dedicated voice evaluation session |
| D-08, D-09 | Share target, attachments | After the vertical slice ships |
| D-10 | Background sync | Not set |
| D-11 | Revision viewer | With H1b; if H1b never exists, at the first real two-device conflict (to confirm) |
| D-22 | Session list / revoke | Invitee #4 |

## 6. Gaps — forks no document covered, and where each stands

### 6.1 Closed by a ruling

| Gap found 2026-10-10 | Closed by |
|---|---|
| Entries list had no spec | D-14 / D-14a: a widget; a temporary dialog for the slice |
| Dashboard meaning | D-18, D-31: the home of the widgets selected on a Widgets page |
| Capture intent | D-07: typeless; the automatic timestamp is the journal angle |
| Out-of-app capture, attachments | D-08, D-09: deferred |
| Token expiry with an unsynced outbox | D-04 |
| Rejected mutation, sign-out with unsynced data, second-device first sync | D-27, D-28, D-29 |
| Local data after sign-out / account change | D-50 |
| Reminders | D-07 + the hooks ruling: none at capture; at most a scheduled digest (D-45) |
| Invitee data rights | D-48, D-49, D-52 |
| Scheduled run has no user session | D-44 (amends A11 when H5 starts) |
| Prompt on the clipboard | D-54 |

### 6.2 Still open

1. **Widget model details:** what "version" means for a clone (lineage link recommended, unconfirmed), whether
   Dashboard order is a widget setting (recommended, unconfirmed), whether the "active" flag is per account or per
   device (treated as per account).
2. **D-13 shape:** location and decoration of the one-time warning; whether any place shows outbox count and retry.
3. **D-19 fallback:** "H1 + system widgets if no lens is kept" is my reading, not yet confirmed.
4. **D-11 re-entry** if H1b never exists.
5. **D-36 amendment** (last report cached per widget, synced to the server) was recorded from a message labelled
   "D-20"; read as D-36, not yet confirmed.
6. **Docs that now disagree with the rulings** (edits owed, none made): PROJECT.md tier table and decision log
   (H1b conditional, H3/H5/Task evidence gates, widgets), VOCABULARY.md (Widget; parked terms, D-41),
   ARCHITECTURE.md (A11 amendment, D-44; pager), H1-ENTRIES.md S3 scope (data-rights, D-04, D-27–D-29, D-50),
   STATE.md Next. They change once this tree is accepted, in one pass, with a decision-log entry.

## 7. What this tree is waiting on

| From | Item |
|---|---|
| Owner, dated | Approve the D-52 notice wording before S3 ships (tester invite expires 2026-10-24) |
| Owner | Confirm the §6.2 items 1–5 (one line each; defaults are in the text) |
| Owner | Accept this tree as the roadmap basis, which triggers the docs pass in §6.2 item 6 |
| Claude | Draft the D-52 notice; write `S3` scope into `H1-ENTRIES.md` after acceptance |
