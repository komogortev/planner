# H1 — Core loop: accounts, capture, sync (Spec)

**Status: S1 closed, 2026-10-10; S2 next** — §12 Q3–Q9 confirmed by the owner; Q1 settled and Q2 deferred by the
S1 spike ([H1-S1-SPIKE.md](H1-S1-SPIKE.md)). Supersedes the 2026-10-08 draft (whole-snapshot merge over the GitHub data repo). Terms per [VOCABULARY.md](VOCABULARY.md); invariants per
[ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Goal

The first full loop of the helper, nothing more:

1. Open the app (browser tab or installed PWA) → sign in or accept an invite.
2. Land on a blank **capture page**: one text field, one Submit.
3. Submit writes the entry to the device at once, offline or not.
4. The app syncs with the **backend** whenever it can.
5. The backend authenticates the caller, cleans and stores the entry, and serves entries back on query.

**Acceptance (exit).** One week of daily capture on the phone (installed PWA — the owner's is Android) and the desktop (browser), both signed in
to the same account:

- every entry written on either device is present on both and on the backend;
- an entry written offline, with the app then closed and reopened, still shows as unsynced and syncs on reconnect;
- a push replayed twice creates one entry (idempotency, §6);
- a second account sees none of the first account's entries (isolation, §8);
- the financial screens are out of the nav and their data is still reachable by URL.

## 2. Decisions taken for this spec (owner, 2026-10-09)

| # | Decision | Replaces |
|---|---|---|
| B1 | **A hosted backend exists**: it authenticates, cleans, stores and serves entries | "No hosted backend" (PROJECT constraints) |
| B2 | **Backend = Cloudflare Workers + D1** (working choice; comparison in §11) | GitHub Contents API as the entries store |
| B3 | **Accounts, invite-only, multi-tenant from day one**: every row carries `user_id`, enforced server-side; sign-up needs an invite | PAT-per-device "Connect" |
| B4 | **Budget: $0 now, the $5/month Workers Paid plan allowed later** | — |
| B5 | **The backend may read entry content** (provider encryption at rest; no end-to-end encryption) | "Owner holds the data; no third party but the model" |
| B6 | **Sign-in with Google or GitHub only** — no passwords stored, no email service | — |
| B7 | **Vocabulary confirmed: Lens** (H0 exit) | — |
| B8 | **Work entries = personal obligations only**, never employer content (closes old Q9) | — |

## 3. Scope

| In (H1) | Out (where) |
|---|---|
| Worker + D1: auth, invites, push / pull / query, cleaning, rate limit | Categories, tags UI, Inbox view, category rules → **H1b Organise** |
| Client: sign-in screens, capture page as home, outbox sync, sync status, storage usage display | Lenses, slices, reports → H2 |
| Dexie v4: `entries`, `outbox`, `syncMeta` | Remote MCP endpoint → H3 |
| Financial screens out of the nav (routes kept, L1 GitHub sync kept for them only) | Attachments (photo, voice) → later |
| | Local eviction of old synced entries → later; re-entry in §9 |
| Nightly export of the owner's entries to the private data repo (§9) | Public sign-up, account deletion UI → before any invitee beyond the owner (§12 Q6) |
| Install-prompt mount race fix + "show install button again" (carried) | Push notifications → H5 |

**Why H1 narrows:** the owner's first loop is capture → sync → serve. Organising is the next loop and needs the backend
to exist first. `Entry.categoryId` and `Entry.tags` are in the schema from H1 so H1b needs no entry migration.

## 4. System

```
CLIENT  (static PWA, GitHub Pages, $0)                    BACKEND  (Cloudflare Worker + D1)
┌──────────────────────────────────────────┐             ┌────────────────────────────────────┐
│ auth/   sign-in → session token (bearer) │── HTTPS ───▶│ /auth/*   OAuth (Google, GitHub),   │
│ views/  Capture (home) · Settings        │             │           invite check, sessions    │
│ db/     Dexie v4: entries, outbox,       │   push      │ /sync/push   clean · validate ·     │
│         syncMeta (persisted)             │────────────▶│              stamp server_version   │
│ sync/   flush outbox · pull since cursor │   pull      │ /sync/pull   changes > cursor       │
│         · usage display · persist()      │◀────────────│ /entries     query (date, text)     │
│ domain/ Entry type + cleaning rules ─────┼── shared ──▶│ clean/  imports the same rules      │
└──────────────────────────────────────────┘             │ D1: users, invites, sessions,       │
                                                          │     entries, entry_revisions        │
                                                          └────────────────────────────────────┘
```

**The capture rule.** An entry is *captured* when it and its outbox row are committed in **one Dexie transaction**.
Sync is later and never gates capture. A failed sync leaves the outbox row; nothing is lost.

## 5. Data model

### 5.1 Client (Dexie v4)

```ts
interface Entry {
  id: string                  // uuid v4, generated on the device (idempotency key, §6)
  body: string                // owner text, plain text with line breaks; never rewritten by the app or AI
  createdAt: string           // ISO datetime, device clock = capture time
  occurredAt: string | null   // YYYY-MM-DD when the event date differs from capture
  categoryId: string | null   // null = Inbox (UI in H1b)
  tags: string[]              // [] in H1 (UI in H1b)
  origin: 'author'            // A1
  updatedAt: string           // device clock, display only — never decides a conflict
  deletedAt: string | null    // soft delete
  serverVersion: number | null // null until the backend has acknowledged it
}

interface OutboxRow {
  seq: number                 // auto-increment: flush order
  entityId: string
  op: 'upsert' | 'delete'
  baseVersion: number | null  // serverVersion the edit was made against (§6.3)
  payload: Partial<Entry>
  attempts: number; lastError: string | null; queuedAt: string
}

interface SyncMeta {          // one row per signed-in account
  userId: string
  cursor: number              // highest server_version pulled
  lastPushAt: string | null; lastPullAt: string | null
}
```

```
entries:  'id, createdAt, occurredAt, categoryId, *tags, updatedAt, serverVersion'
outbox:   '++seq, entityId'
syncMeta: 'userId'
```

- The **"unsynced" status is `outbox.count() > 0`** — persisted, so it survives a reload. This retires the in-memory
  `dirty` flag for entries (the L1 flag was lost on reload; see the 2026-10-09 finding in STATE).
- The session token lives in IndexedDB (not `localStorage`), read only by `auth/`.
- Signing out clears `entries`, `outbox` only after confirming an empty outbox, or with an explicit "discard N unsynced
  entries" confirm.

### 5.2 Backend (D1)

```sql
users           (id TEXT PK, email TEXT UNIQUE, name TEXT, created_at INTEGER,
                 version_seq INTEGER NOT NULL DEFAULT 0)          -- per-user change counter
identities      (provider TEXT, provider_user_id TEXT, user_id TEXT, PK (provider, provider_user_id))
                                                                  -- S1: one user, many providers
invites         (code TEXT PK, email TEXT, created_by TEXT, used_by TEXT, expires_at TEXT)
sessions        (token_hash TEXT PK, user_id, created_at, expires_at)   -- S1: own table, SHA-256 of the token
entries         (user_id TEXT, id TEXT, body TEXT, created_at TEXT, occurred_at TEXT, category_id TEXT,
                 tags TEXT /* JSON array */, updated_at TEXT, deleted_at TEXT,
                 server_version INTEGER NOT NULL, received_at TEXT,
                 PRIMARY KEY (user_id, id))
entry_revisions (user_id TEXT, id TEXT, server_version INTEGER, body TEXT, replaced_at TEXT)  -- §6.3
INDEX entries(user_id, server_version) ; INDEX entries(user_id, created_at)
```

- **Composite primary key `(user_id, id)`.** Client ids are uuids, but the built-in category ids (`cat-*`, H1b) repeat
  across accounts, so every table keys on the owner of the row.
- `server_version` = `users.version_seq` incremented in the same D1 batch as the write.

## 6. Sync protocol

### 6.1 Push

`POST /sync/push`  `{ mutations: OutboxRow[] (≤ 100) }` →
`{ results: [{ entityId, status: 'applied' | 'duplicate' | 'rejected', serverVersion?, conflict?, error? }] }`

- Applied in `seq` order inside one D1 batch per request.
- **Idempotent:** an upsert whose `(user_id, id)` exists with identical cleaned content returns `duplicate` with the
  stored `serverVersion`; replaying a push never creates a second entry.
- `rejected` (validation failure) carries a reason; the client keeps the row, marks it, and shows it — it never drops a
  rejected entry silently.
- The client deletes an outbox row only on `applied` or `duplicate`, and writes back `serverVersion`.

### 6.2 Pull

`GET /sync/pull?since=<cursor>&limit=500` → `{ changes: Entry[], cursor, more: boolean }`

- Returns rows with `server_version > since`, ascending, **including soft-deleted ones**, so a delete reaches every
  device and an old device cannot resurrect it.
- The client applies a pulled row unless that entity has a pending outbox row (local edit wins locally until pushed;
  the server decides on push).

### 6.3 Conflicts — the server orders, nothing is lost

Device clocks never decide. Each mutation carries `baseVersion`.

- `baseVersion` equals the stored `server_version` (or the row is new) → apply.
- Stale `baseVersion` (another device edited first) → **apply anyway, and copy the replaced body into
  `entry_revisions`**; respond `conflict: true`. The client shows "edited on two devices — the earlier text is kept
  in history". No modal, no lost text. Entries are mostly append-only, so this path should be rare; the count is logged.
- Delete vs edit: a delete with a stale base still applies (owner intent), with the replaced body kept in revisions.

### 6.4 When sync runs

There is no background sync on iOS Safari or Firefox (no Background Sync API). Sync runs: on app start, on
`visibilitychange → visible`, on `online`, 2 s after a capture, and every 60 s while visible. Exponential backoff on
failure (cap 5 min). Estimated load for one user: ≤ 500 requests/day, under 1 % of the free tier's 100,000.

## 7. Cleaning and validation (one rule set, `src/domain/clean.ts`)

Runs on the client before the outbox write (fast feedback) and again on the server (authority).

- `body`: Unicode NFC; strip control characters except `\n` and `\t`; trim trailing whitespace; 1–20,000 characters.
  **Plain text only** — stored as written, never as HTML, escaped at render. The body is not otherwise changed.
- `occurredAt`: `YYYY-MM-DD` or null. `tags`: ≤ 20, each ≤ 40 chars, lowercased, deduped. Unknown fields dropped.
- Server-side only: `user_id` comes from the session, **never from the request body**; `server_version`,
  `received_at` are server-stamped.
- "Cleaning" never redacts or rewrites content (A1); detecting secrets or personal data, if ever wanted, flags, it does
  not edit.

## 8. Auth, accounts, isolation

- **Sign-in:** OAuth 2 with Google or GitHub (B6). First sign-in with a valid invite creates the account; without one,
  the backend refuses and creates nothing.
- **Invites:** single-use code bound to an email, expiring; created by the owner (a CLI script against D1 in H1; UI
  later). The owner's account is seeded by the same script.
- **Token transport: `Authorization: Bearer`, not cookies.** The client (`*.github.io`) and the Worker (`*.workers.dev`)
  are different sites, and Safari blocks cross-site cookies. Bearer tokens make injected script the main threat, hence
  plain-text bodies (§7) and a CSP that allows only the Worker origin for `connect-src`.
- **CORS:** the Worker allows exactly the Pages origin (plus `localhost:5176` in dev).
- **Isolation:** every query is built by one data-access helper that takes `userId` as a required argument; a test
  asserts that account B reading account A's entry id gets 404 (negative control, §10).
- **Offline:** a valid session lasts 30 days, renewed on each successful sync. An expired session never blocks capture —
  entries queue; sync shows "sign in again"; the outbox flushes after sign-in.
- **Rate limit:** per user and per IP on `/auth/*` and `/sync/push`.

## 9. Local storage and backup

- **Full copy on the device in H1.** Text at ~10 entries/day is ~4 MB/year, far below browser quotas, so H1 builds
  no eviction (cut by the owner 2026-10-09). Settings shows usage from `navigator.storage.estimate()` — that display is
  the trigger for the later work. `/entries` (query) is still built in S2: the backend serves it for H2 and the export.
- **Eviction re-enters when** local usage passes **50 MB** (the display shows it) **or** attachments are scoped,
  whichever comes first. Its rules are already fixed: only **synced** entries are evicted, oldest first, fetched back
  through `/entries` on demand; outbox rows are never evicted.
- **`navigator.storage.persist()`** is requested after sign-in. It is not called anywhere today, so browsers may evict
  the database under storage pressure. Safari does not fully honour it; the real protection is frequent sync.
- **Backup (the recovery path):** D1 Time Travel (point-in-time restore) plus a **nightly Worker cron export** of the
  owner's entries as JSON to the private data repo (owner-held copy). Per-user export for invitees is §12 Q6.

## 10. Verification plan — known positives first

Each check is written to fail before the code that passes it exists.

| Check | Must fail when | Kind |
|---|---|---|
| Capture is atomic | entry written without its outbox row (simulate a throw between the two) | unit, negative control |
| Unsynced survives reload | outbox non-empty, reload → status says "synced" | e2e |
| Push idempotency | the same push sent twice → two rows | worker test |
| Isolation | account B gets account A's entry by id | worker test, negative control |
| Stale-base edit keeps text | a stale edit leaves no `entry_revisions` row | worker test |
| Delete is not resurrected | old device pushes an edit after a pulled delete → row reappears undeleted | worker test |
| Cleaning | control chars survive, a 20,001-char body is accepted, a foreign `user_id` in the payload is honoured | shared unit + worker test |
| Render escaping | a body containing `<img src=x onerror=…>` executes when shown | component test, negative control |
| Invite gate | OAuth success without an invite creates a `users` row | worker test, negative control |
| Free-tier CPU | a request measured over 10 ms CPU | S1 spike measurement |

## 11. Backend choice — why Workers + D1

Measured against price, scale and reliability, 2026-10-09 (sources in the PR description):

| | Cost (1 user / ~100) | Reliability note | Server logic | Offline sync | Lock-in |
|---|---|---|---|---|---|
| **Workers + D1 (chosen)** | $0 (100k req/day, 5 GB, 5M rows read/day, 100k written/day) / $5 per month | managed edge, no idle pause | full: our code | ours (§6) | low (SQLite) |
| Dexie Cloud | €0 for 3 users, 100 MB / €0.12 per user per month | small vendor | none (client-side cleaning) | built in, on our Dexie | high |
| Supabase | $0, 500 MB / $25 per month | **free project pauses after 7 idle days** | functions + DB rules | ours or add-on | low |
| Firebase | $0 within daily quotas / pay-as-you-go | Google-managed | functions need the paid plan | built in, replaces Dexie | high |
| PocketBase on a VPS | ~$4–5 per month | we run the box | full | ours | low |

Workers + D1 is the only option that is free with no idle pause and runs our own code, which the loop needs
(clean, query) and H3 reuses (remote MCP endpoint → chat from the phone). Cost: we write sign-in and sync. Dexie Cloud
stays the fallback if the S1 spike fails on CPU or auth.

## 12. Questions

Q3–Q9: **defaults confirmed by the owner 2026-10-09** and binding. Q1–Q2: settled by the S1 spike.

| # | Question | Default |
|---|---|---|
| Q1 | Auth library | **Settled (S1): own OAuth code (fetch + Web Crypto) + Hono + our own `sessions` table.** Arctic was deprecated by its maintainer 2026-07; Better Auth is 210 KB gz. p50 1–5 ms CPU per route |
| Q2 | **iPhone home-screen sign-in round trip** — whether the OAuth redirect returns into the installed app or strands the session in Safari's storage | **Deferred (owner, 2026-10-10): the owner's phone is Android.** Re-entry: before the first invitee with an iPhone/iPad, or if the owner moves to one. Known fallback: handoff by polling — the app opens sign-in, then polls `/auth/handoff/<id>` until the Worker has the result |
| Q3 | Conflict policy | **Apply + keep the replaced body in `entry_revisions` (Recommended)** (§6.3) |
| Q4 | Owner may delete an entry | **Yes, soft delete with confirm (Recommended)**; purge after 30 days is a later decision |
| Q5 | Home route | **Capture page is `/` (Recommended)**; Dashboard retires with the financial screens |
| Q6 | Invitee data rights (export, delete account) | **Required before the first invitee beyond the owner (Recommended)**; not in H1 if H1 runs owner-only |
| Q7 | Text query in `/entries` | **`LIKE` in H1; D1 FTS5 when search becomes a feature (Recommended)** |
| Q8 | Custom domain (client + API same site → cookies possible) | **No custom domain; bearer tokens (Recommended).** *Amended 2026-10-10 (Claude, delegated): the client moves from the shared `komogortev.github.io` to its own free `*.pages.dev` origin at S4* — see [H1-S2-BACKEND.md](H1-S2-BACKEND.md) Decisions |
| Q9 | Existing GitHub sync after H1 | **Kept for the frozen financial tables only (Recommended)**; entries never enter `data.json` |

## 13. Slices of work

| Slice | Content | Done when |
|---|---|---|
| S0 ✅ | This spec; §12 closed | owner sign-off (2026-10-09) |
| S1 ✅ **Spike** (closed 2026-10-10; iPhone deferred) — [H1-S1-SPIKE.md](H1-S1-SPIKE.md) | Worker + D1 hello on the free plan; OAuth with GitHub and Google from the deployed Pages origin; **iPhone home-screen sign-in**; CPU per request measured | all three work, or the fallback is chosen with evidence |
| S2 Backend — [H1-S2-BACKEND.md](H1-S2-BACKEND.md) | D1 schema + migrations, invite script, push/pull/query, cleaning, rate limit, worker tests (§10) | worker tests green incl. negative controls |
| S3 Client | Dexie v4, capture page as home, sign-in screens, `sync/` loop, outbox status, `persist()`, storage usage in Settings | capture → sync → second device shows it, in dev |
| S4 Cut-over | financial screens out of nav, deploy Worker + Pages, nightly export cron, owner account seeded | owner signed in on phone + desktop in production |
| S5 Exit week | daily real use; acceptance §1 checked item by item | §1 all true |

## 14. Files this spec will touch (preview)

New: `api/` (Worker: `package.json`, `wrangler.toml`, `src/routes/*`, `src/db/*`, migrations, tests),
`src/domain/{entry,clean}.ts`, `src/auth/*`, `src/sync/*`, `src/stores/entries.ts`, `src/views/CaptureView.vue`,
`src/views/SignInView.vue`. Changed: `src/db/schema.ts`, `src/db/index.ts` (v4), `src/router/index.ts`, `App.vue` nav,
`src/components/SyncStatusPill.vue`, `src/main.ts` (install-prompt capture before mount), `vite.config.ts` (CSP).
