# L1 — GitHub Contents API Sync (Design)

Snapshot-on-demand sync between local Dexie state and a single `data.json` in the user's private GitHub repo. No backend, no OAuth flow — fine-grained Personal Access Token only.

This doc is the design baseline for slices S1–S5. The on-disk format is in [`STORAGE-FORMAT.md`](./STORAGE-FORMAT.md).

## Architecture summary

```
┌─────────────────┐                          ┌──────────────────────┐
│  Personal       │   PUT /contents/data.json│  github.com          │
│  Planner PWA    │ ────── (with sha) ─────▶ │  api                 │
│  (browser)      │                          │                      │
│                 │   GET /contents/data.json│  Repo:               │
│  Dexie ↔ Stores │ ◀──────────────────────  │  komogortev/         │
│       ↕         │                          │  planner-data        │
│  GitHub adapter │   GET /user (validate)   │  (private)           │
│  + PAT (Dexie)  │ ────────────────────────▶│  └ data.json         │
└─────────────────┘                          └──────────────────────┘
```

Single endpoint family. Single file. PAT lives in IndexedDB on the device, never touches a server.

## Auth

### PAT contract (set up in setup walkthrough; see SETUP-GITHUB-PAT.md)

- Type: **Fine-grained Personal Access Token** (not classic)
- Resource owner: user's GitHub account
- Repository access: **only** the data repo (e.g. `komogortev/planner-data`)
- Permissions: `Contents: Read and write` (only). `Metadata: Read-only` is auto-added.
- Expiry: ≤ 90 days
- Format: `github_pat_…`

### Storage

- Stored in a new Dexie `settings` table (single-row), introduced in `version(2)` of `PlannerDb`
- Table shape:

  ```ts
  interface AppSettings {
    id: 'singleton'             // fixed primary key, only ever one row
    pat: string                 // github_pat_…
    owner: string               // 'komogortev'
    repo: string                // 'planner-data'
    githubLogin: string         // result of GET /user .login (validation receipt)
    deviceId: string            // generated on Connect (see STORAGE-FORMAT.md)
    lastKnownSha: string | null // sha of data.json from last successful sync
    lastSyncedAt: string | null // ISO timestamp of last successful sync
  }
  ```

- Migration: `version(2)` adds `settings: 'id'` to the schema; `.upgrade(trans => {})` is a no-op (no backfill needed; absence of row = not connected)
- Reads/writes go through a Pinia store (`useSettingsStore`) so the UI is reactive

### Why not in-memory only

Original Sheets plan stored OAuth tokens in memory only — fine for short-lived 1-hour tokens. PATs are long-lived (90 days). Re-pasting on every reload is hostile UX. The PAT lives on the same device as the Dexie data it protects; same threat model already applies. Trade documented in `PROJECT.md` decision entry 2026-04-26.

## API surface — only 4 calls

| Purpose | Method | Endpoint | When |
|---|---|---|---|
| Validate PAT | `GET` | `/user` | Connect form submit |
| Validate repo + privacy | `GET` | `/repos/{owner}/{repo}` | Connect form submit (after `/user`) |
| Restore | `GET` | `/repos/{owner}/{repo}/contents/data.json` | "Restore from GitHub" button |
| Sync | `PUT` | `/repos/{owner}/{repo}/contents/data.json` | "Sync now" button |

All requests carry `Authorization: Bearer <pat>` and `Accept: application/vnd.github+json`.

> **Restore deviation (decided during S2 implementation, 2026-04-26):** Restore uses the **standard JSON wrapper** (not `Accept: vnd.github.raw`). The wrapper response includes both `content` (base64) and `sha` in a single response, eliminating a second metadata round-trip. Base64 overhead is negligible at expected payload sizes (10–100 KB). Decoding is via `atob` + `TextDecoder('utf-8')` to preserve non-ASCII (notes fields, emoji). See `src/db/github.ts:getDataJson`.

### Sync request body

```jsonc
{
  "message": "sync from desktop-2026-04-26 @ 2026-04-26T18:42:13Z",
  "content": "<base64 of pretty-printed data.json>",
  "sha": "<lastKnownSha or omitted on first-ever write>"
}
```

`sha` is GitHub's optimistic-concurrency token. PUT with stale `sha` → 409 Conflict.

## Sync flows

### Connect (S1)

```
User opens Settings → pastes PAT, owner, repo → clicks Connect
  │
  ├─▶ Validate PAT format client-side (starts with 'github_pat_')
  │
  ├─▶ GET /user
  │     ├─ 401 → "GitHub rejected your token. Check it and try again."
  │     ├─ network error → "Can't reach github.com. Check your connection."
  │     └─ 200 → capture .login as githubLogin
  │
  ├─▶ GET /repos/{owner}/{repo}
  │     ├─ 404 → "Repo not found, or your token doesn't have access. Check spelling
  │     │        and the token's repository access list."
  │     ├─ 200 with .private === false → REFUSE: "Repo is public. Refusing to write
  │     │        personal data to a public repo. Make it private and reconnect."
  │     └─ 200 with .private === true → proceed
  │
  ├─▶ Generate deviceId: `${platform}-${YYYY-MM-DD}` of today
  │     where platform = 'phone' | 'tablet' | 'desktop' (heuristic: matchMedia + UA)
  │
  └─▶ Persist settings row, redirect to dashboard with "Connected as @login" toast
```

### Restore from GitHub (S2)

```
User clicks "Restore from GitHub"
  │
  ├─▶ GET /contents/data.json (JSON wrapper — see deviation note above)
  │     ├─ 404 → first-run case. Copy now also covers PAT propagation:
  │     │        "No data.json yet in {owner}/{repo}. Run 'Sync now' on a device
  │     │         that has data to seed it. (If you just created or updated the PAT,
  │     │         wait 30 seconds — GitHub takes a moment to propagate access changes.)"
  │     │        Exit flow.
  │     ├─ 401 → "GitHub rejected your token. Reconnect in Settings."
  │     ├─ network error → "Can't reach github.com." retry button.
  │     └─ 200 → parse JSON, capture sha from response headers
  │
  ├─▶ Validate snapshot:
  │     ├─ schemaVersion > 1 → "Newer app version wrote this data. Please update the app."
  │     ├─ schemaVersion < 1 → run forward migrations (none yet)
  │     ├─ recordCounts mismatch array lengths → "data.json is corrupt. Cancelling restore."
  │     └─ JSON parse error → same corrupt message
  │
  ├─▶ Detect local state:
  │     localTotal = commitments.count + payments.count + intentions.count + marketEntries.count
  │
  ├─▶ Show confirmation modal:
  │     ├─ if localTotal === 0:
  │     │     "Populate local data with N commitments, M payments, K intentions,
  │     │      L market entries from GitHub?"
  │     │     [Cancel]  [Populate]
  │     └─ if localTotal > 0:
  │           "⚠ This will REPLACE your N local commitments / M payments / …
  │            with the GitHub snapshot (N' / M' / …).
  │            Local-only records will be lost.
  │            Last synced: {lastSyncedAt or 'never'}."
  │           [Cancel]  [Replace local data]   ← destructive button styling
  │
  └─▶ On confirm: Dexie transaction (rw, all 4 tables):
        clear all 4 → bulkAdd from JSON → in same transaction update
        settings.lastKnownSha + settings.lastSyncedAt
        → UI live-queries re-render automatically
```

### Sync now (S3) — ✅ shipped 2026-04-26

> **Implementation:** `useSyncStore.syncNow` in `src/stores/sync.ts`. Builds via `buildSnapshot()` + `serializeSnapshot()` (`src/db/snapshot.ts`), PUTs via `putDataJson()` (`src/db/github.ts`). UTF-8 base64 encode is chunked (`encodeUtf8Base64`) to stay safe as snapshots grow. Dirty-bit cleared on 200; on 409/422 the latest remote is re-fetched and stashed as `pendingConflict` for S4's modal.

```
User clicks "Sync now"
  │
  ├─▶ Build snapshot in memory:
  │     - Read all 4 Dexie tables (toArray)
  │     - Compute recordCounts
  │     - Pretty-print JSON (2-space indent)
  │     - base64 encode
  │
  ├─▶ Build commit message:
  │     `sync from {deviceId} @ {exportedAt}`
  │
  ├─▶ PUT /contents/data.json with body:
  │     { message, content: <base64>, sha: lastKnownSha or undefined }
  │     ├─ 200/201 → store new sha (response.content.sha) + lastSyncedAt = now
  │     │            Toast: "Synced N records to GitHub."
  │     ├─ 409 Conflict → see "Conflict" flow (S4)
  │     ├─ 422 (sha invalid in some cases) → treat as 409, fetch latest, conflict modal
  │     ├─ 401 → "GitHub rejected your token. Reconnect in Settings."
  │     ├─ 403 with X-RateLimit-Remaining: 0 → "Hit GitHub rate limit. Try again at HH:MM."
  │     └─ network error → "Can't reach github.com." retry.
```

### Conflict (S4)

Triggered when Sync returns 409 (or 422 with sha-conflict body).

```
1. Fetch latest: GET /contents/data.json (Accept: raw) AND
   GET /repos/{owner}/{repo}/commits?path=data.json&per_page=1 (for author/date/message)

2. Show modal:
   ┌─────────────────────────────────────────────┐
   │ Sync conflict                               │
   │                                             │
   │ Remote was updated since your last sync.    │
   │                                             │
   │ Last sync from this device:  {lastSyncedAt} │
   │ Remote update:               {commit.date}  │
   │                              by {commit.author}│
   │                              "{commit.message}"│
   │                                             │
   │ Remote has:  N commitments / M payments /…  │
   │ Local has:   N' / M' / …                    │
   │                                             │
   │ [ Cancel ]  [ Pull remote first ]  [ Overwrite remote ] │
   └─────────────────────────────────────────────┘

3. Actions:
   - Cancel → close, do nothing. Local stays dirty.
   - Pull remote first → enter Restore flow (with the just-fetched JSON, no extra GET).
     After successful restore, user can re-do their local edits and Sync again.
   - Overwrite remote → re-PUT with the freshly-captured sha. Last-write-wins by id
     plays out at the array level: local snapshot replaces remote entirely.
```

### Disconnect

Clears the settings row. Does not touch local data. Does not touch the remote `data.json`. After disconnect, user can reconnect with a different PAT or different repo.

## Status UI (S4)

Header pill, always visible after connect:

| Local state vs. last known sha | Pill text | Color |
|---|---|---|
| `lastSyncedAt == null` | "Not synced yet" | amber |
| local hash == hash at last sync | "Synced {relative time} ago" | neutral |
| local hash != hash at last sync | "Unsynced changes" | amber |
| Error during last attempt | "Sync error — retry" | red, click → modal |

"local hash" = hash of the rebuilt JSON snapshot. Cheap; only computed when stores change. Or we sidestep by tracking a "dirty since sync" boolean updated on any Dexie write — simpler, less precise (false positives if user adds + deletes same record).

Recommendation for first cut: dirty-bit. Hash if dirty-bit churns too much.

## Open question resolutions

These were captured in STATE.md after the L1 backend pivot. Resolved here.

### Q1 — Restore semantics on empty vs populated local state

**Resolved.** Same flow underneath, **different confirmation copy + button styling** based on `localTotal`. See "Restore from GitHub (S2)" flow above. Empty case uses neutral "Populate" button; populated case uses destructive-styled "Replace local data" button with explicit data-loss warning.

### Q2 — `payments` derived fields on Restore

**Resolved: trust the JSON values, do not recompute.** Three reasons:

1. `principalPortion` / `interestPortion` / `balanceAfter` are computed at log time from `commitment.principal − sum(prior principalPortion)` and persisted (`stores/commitments.ts:60-86`). They are not live-derived.
2. Recomputation assumes payments are in date order with amounts matching standard amortization. The notes field already hints at violations ("extra $200 toward principal"). Recomputation would silently disagree with the user's actual reality.
3. `STORAGE-FORMAT.md` lists these fields as **required**. Restore validation rejects snapshots missing them rather than silently filling — fail loud.

### Q3 — PAT validation failure modes

**Resolved.** Mapped in the Connect flow above. Summary table:

| HTTP / condition | User-facing copy | Recovery action |
|---|---|---|
| 401 from `/user` | "GitHub rejected your token. Check it and try again." | Re-paste in Settings |
| 404 from `/repos/{o}/{r}` | "Repo not found, or your token doesn't have access. Check spelling and the token's repo access list." | Re-check Settings |
| 200 with `private === false` | "Repo is public. Refusing to write personal data to a public repo. Make it private and reconnect." | Toggle repo to private in GitHub UI |
| 404 from `/contents/data.json` (Restore) | "No data.json yet. Run 'Sync now' on a device with data to seed it." | First-run case, not an error |
| 401 mid-flow (token revoked or expired) | "GitHub rejected your token. Reconnect in Settings." | Re-paste in Settings |
| 403 with `X-RateLimit-Remaining: 0` | "Hit GitHub rate limit. Try again at HH:MM." | Wait until reset time from `X-RateLimit-Reset` |
| Network error / offline | "Can't reach github.com. Check your connection." | Retry button |

### Q4 — Integrity check field in `data.json`

**Resolved: yes, `recordCounts` field is included.** Restore validates that every entity-array length matches the corresponding `recordCounts` integer before touching Dexie. Mismatch → refuse with "data.json is corrupt — record counts don't match arrays." Cheap (4 integer comparisons), catches truncation, partial-write corruption, and parse errors before they wipe local data.

`appVersion` is also included as a diagnostic field (not validated — purely for `git log` debugging).

## Out of scope at L1 (revisit later)

- Per-record merge / `updatedAt`-based three-way reconciliation
- Multi-file storage (per-table commits) — atomicity loss not worth it
- Auto-sync / scheduled sync / multi-device live sync
- PAT rotation reminders / expiry warnings UI
- GitHub OAuth Device Flow (only revisit if PAT rotation friction becomes painful)
- Background sync (service worker pushing on connectivity restore)
- Diff preview before destructive Restore (would need fetching + parsing both sides + a UI)

## Files this design will touch (preview for S1+)

New:
- `src/db/github.ts` — fetch wrapper, request/response types, error mapping
- `src/db/snapshot.ts` — build/parse `data.json`, validate `recordCounts`, schemaVersion checks
- `src/stores/settings.ts` — Pinia store for the singleton settings row
- `src/stores/sync.ts` — Pinia store for sync status (lastSyncedAt, dirty bit, in-flight flag, last error)
- `src/views/SettingsView.vue` — Connect form, status, Restore/Sync buttons, Disconnect
- `src/components/SyncStatusPill.vue` — header pill
- `src/components/ConflictModal.vue` — S4
- `src/router/index.ts` — `/settings` route added

Modified:
- `src/db/index.ts` — bump to `version(2)`, add `settings` store
- `src/db/schema.ts` — add `AppSettings` interface
- `src/App.vue` — mount `<SyncStatusPill>` in header

No changes needed to existing entity stores or views — sync layer is additive.
