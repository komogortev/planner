# Storage Format — `data.json`

L1 sync target. Single canonical file in the user's private GitHub data repo. One commit per `Sync now` = one consistent snapshot of the entire local Dexie state.

This doc is the contract between the app and the file. Changing the file shape requires bumping `schemaVersion` and shipping a migration in the Restore code path.

> **Active backend.** GitHub Contents API. See `L1-GITHUB.md` for transport / auth / sync flow. The Sheets-backed alternative (`SHEETS-STRUCTURE.md`) is deferred.

## File location

- **Repo:** user's private GitHub repo, e.g. `komogortev/planner-data` (configured in Settings)
- **Path:** `data.json` at the repo root
- **Format:** UTF-8 JSON, pretty-printed (2-space indent) for readable diffs in `git log -p`
- **Branch:** `main` (default branch of the data repo)

## Top-level shape

```jsonc
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-04-26T18:42:13Z",
  "deviceId": "desktop-2026-04-26",
  "recordCounts": {
    "commitments": 3,
    "payments": 17,
    "intentions": 5,
    "marketEntries": 12
  },
  "commitments":   [ /* Commitment[] */ ],
  "payments":      [ /* Payment[] */ ],
  "intentions":    [ /* Intention[] */ ],
  "marketEntries": [ /* MarketEntry[] */ ]
}
```

### Top-level field rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | integer | yes | Currently `1`. Bumped only when the on-disk shape changes. Restore refuses to load an unknown version (forward incompatibility is a feature). |
| `appVersion` | string | yes | `package.json` version at write time. Diagnostic only — not used for branching logic. |
| `exportedAt` | ISO 8601 timestamp | yes | When the snapshot was built (client clock). Z-suffixed UTC. |
| `deviceId` | string | yes | Stable per-device label, set on first Connect. Format: `{platform}-{YYYY-MM-DD}` of first connect, e.g. `phone-2026-04-26`. Diagnostic + commit message. |
| `recordCounts` | object | yes | Integrity check. Restore validates that array lengths match these counts before touching Dexie. Mismatch → refuse + error. |
| `commitments` | array | yes | Always present, may be `[]`. |
| `payments` | array | yes | Always present, may be `[]`. |
| `intentions` | array | yes | Always present, may be `[]`. |
| `marketEntries` | array | yes | **camelCase** — matches Dexie table name exactly. Not `market_entries`. |

### Why `marketEntries` not `market_entries`

The Sheets plan used `market_entries` to be tab-name idiomatic. GitHub JSON has no such convention; matching the Dexie table name 1:1 means zero key-mapping in Restore/Sync code. Camelcase wins.

## Entity shapes

Entity arrays contain rows in **exact Dexie schema shape** — no transformation, no rename, no derived fields stripped. The source of truth is `src/db/schema.ts`. This doc duplicates the contract for reviewability; if the two ever disagree, `schema.ts` wins and `schemaVersion` should have been bumped.

### `commitments[]`

```jsonc
{
  "id": "mortgage-house-01",
  "type": "mortgage",                    // 'mortgage' | 'loan' | 'subscription' | 'other'
  "label": "House mortgage",
  "startDate": "2025-09-01",             // YYYY-MM-DD
  "principal": 350000,
  "annualRate": 0.0475,                  // decimal, not percent
  "termMonths": 300,
  "paymentDay": 15,                      // 1–31
  "notes": "fixed rate",                 // string, "" allowed
  "createdAt": "2026-04-22T14:30:00Z",
  "updatedAt": "2026-04-22T14:30:00Z"
}
```

All fields required. `notes` is `""` if empty (not `null`, not omitted) to match the Dexie row shape that always has the property.

### `payments[]`

```jsonc
{
  "id": "pay-mortgage-2026-04",
  "commitmentId": "mortgage-house-01",   // FK to commitments.id
  "date": "2026-04-15",                  // YYYY-MM-DD
  "amount": 1824.50,
  "principalPortion": 824.50,            // computed at log time, persisted
  "interestPortion": 1000.00,            // computed at log time, persisted
  "balanceAfter": 349175.50,             // computed at log time, persisted
  "notes": "",
  "createdAt": "2026-04-15T18:00:00Z"
}
```

**Derived fields are required, not optional.** They are computed once when the payment is logged (commitment principal − sum of prior `principalPortion`) and never recomputed. See [Open question 2 resolution](#q2-payments-derived-fields-on-restore).

### `intentions[]`

```jsonc
{
  "id": "ebike-2027",
  "label": "Commuter e-bike",
  "category": "transport",               // free text
  "targetBudget": 2500,                  // number | null (null = no target set)
  "status": "researching",               // 'considering' | 'researching' | 'committed' | 'acquired' | 'dropped'
  "notes": "waiting for 2027 models",
  "createdAt": "2026-04-22T14:30:00Z",
  "updatedAt": "2026-04-22T14:30:00Z"
}
```

`targetBudget: null` means "no target set". Do **not** use `0` (means budget is zero) and do not omit the field.

### `marketEntries[]`

```jsonc
{
  "id": "obs-ebike-2026-04-22-canyon",
  "intentionId": "ebike-2027",           // FK to intentions.id
  "observedAt": "2026-04-22",            // YYYY-MM-DD
  "pricePoint": 2799,
  "source": "canyon.com",
  "availability": "in-stock",            // 'in-stock' | 'limited' | 'unavailable' | null
  "notes": "free shipping promo",
  "createdAt": "2026-04-22T14:30:00Z"
}
```

`availability: null` means "not observed / not applicable". Append-only by convention in the app, but the JSON snapshot doesn't enforce — Restore will replace whatever's there.

## Cross-tab referential integrity

```
commitments.id  ←  payments.commitmentId
intentions.id   ←  marketEntries.intentionId
```

Restore does **not** validate FKs. Orphan payments (referencing a deleted commitment) or orphan market entries are tolerated — they just won't render in the UI. The app's local state can also have orphans (we don't cascade-delete), so enforcing in Restore would diverge.

## Schema versioning

- `schemaVersion: 1` is frozen. The on-disk shape is part of the public contract with the user's data repo.
- Adding a new optional field in a future version → bump to `2`, write a Restore migration that defaults the field on old snapshots.
- Removing or renaming a field → bump to `2`, write a Restore migration that drops/renames.
- Restore loading a snapshot with `schemaVersion > current app` → refuse. Show: "This data was written by a newer version of Personal Planner. Please update the app." Forward incompatibility is intentional.
- Restore loading `schemaVersion < current app` → run forward migrations in order, then load. Same discipline as Dexie `version(N+1).upgrade(...)`.

## Example minimal snapshot

```json
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-04-26T18:42:13Z",
  "deviceId": "desktop-2026-04-26",
  "recordCounts": { "commitments": 0, "payments": 0, "intentions": 0, "marketEntries": 0 },
  "commitments": [],
  "payments": [],
  "intentions": [],
  "marketEntries": []
}
```

This is what the first `Sync now` from a freshly-installed app writes. Subsequent syncs only differ by record counts and array contents.
