# L2 — Organization (Design)

Three-layer organization model on top of the L0/L1 entity base — **Category** (single-pick controlled vocabulary), **Theme** (cross-cutting many-to-many container with progression), **Tag** (free-form folksonomy).

This doc is the design baseline for slices S1–S5. The on-disk format change is captured here too (no separate `STORAGE-FORMAT.md` revision — bumping `schemaVersion` to `2` and inlining the diff is enough at this scale).

> **Status:** S0 design complete. Open questions Q1–Q5 resolved 2026-04-28 — see "Open question resolutions" at bottom.

## Why three layers, not just tags

The user's mental model already separates two concepts that pure-tag systems conflate:

| Concept | Cardinality | Has own metadata? | Example |
|---|---|---|---|
| *the bucket the thing IS in* | exactly one | no | "this is a `travel` thing" |
| *the goal it CONTRIBUTES to* | many | yes (target date, status, progression) | "this funds the `Cabin Trip`" |
| *ad-hoc filter for current task* | many | no | "show me anything tagged `urgent`" |

Single-pick **Category** is the bucket. Many-to-many **Theme** with its own row is the goal. Free-form **Tag** is the filter primitive. Tag-only systems also drift on synonyms ("travel" / "vacation" / "trips") and can't carry structured fields (no target date on a tag).

Industry pattern aligns: **Things** layers Areas + Projects + Tags. **Notion** layers DB Select + Relation + Multi-select. **Linear** layers Teams + Projects + Cycles + Labels. **Obsidian** layers Folders/properties + MOCs + Tags. The three-layer split is consistent across mature tools.

## Architecture summary

```
                  ┌────────────────────────────────────┐
                  │              Theme                 │
                  │  (id, label, status, targetDate,   │
                  │   targetAmount?, notes, …)         │
                  └────────────────────────────────────┘
                                   ▲
                                   │  themeMembers
                                   │  (themeId × entityType × entityId)
                                   │
        ┌─────────────────┬────────┴────────┬─────────────────┐
        │                 │                 │                 │
   Commitment        Intention         MarketEntry      (future entity types)
        │                 │                 │
        │ categoryId      │ categoryId      │ categoryId      ← Category (single-pick)
        │ tags[]          │ tags[]          │ tags[]          ← Tag    (free folksonomy)
        ▼                 ▼                 ▼
        ●                 ●                 ●
```

- **Category** is a foreign key on every domain entity (`categoryId: string | null`).
- **Tag** is a multi-value string field on every domain entity (`tags: string[]`), Dexie-indexed multi-entry.
- **Theme** is its own entity with members tracked in a `themeMembers` join table that supports any of the 3 (and future) entity types.

## Data model

### Category

Single-pick, controlled vocabulary, user-extensible. Each entity has exactly zero or one. Built-ins seeded on first run with v3 migration; the user can add more in Settings → Categories.

```ts
export interface Category {
  /** stable id, e.g. 'cat-purchases' for built-ins, generated for user adds */
  id: string
  /** display label, e.g. 'Purchases' */
  label: string
  /** used for stable sort + display order; built-ins have low sort values */
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

**Deletion semantics (resolved Q1, 2026-04-28):** Refuse delete when in use. Picker shows "in use by N rows — reassign first" with a link to the affected rows. No `archived` flag in MVP — hide-without-delete is a separate concern; revisit in L3 if real usage requires it.

**Built-ins seeded on v2→v3 upgrade:** `purchases`, `travel`, `skill-development`, `subscriptions`. Seed list lives in `src/db/categorySeed.ts`.

### Theme

Cross-cutting many-to-many container with own metadata. Pulls items together regardless of category or entity type.

```ts
export type ThemeStatus = 'active' | 'paused' | 'achieved' | 'cancelled'

export interface Theme {
  id: string
  label: string
  status: ThemeStatus
  /** optional target date (YYYY-MM-DD) for progression tile */
  targetDate: string | null
  /** optional target spend amount for progression rollup */
  targetAmount: number | null
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ThemeMember {
  /** synthetic id, generated on attach */
  id: string
  themeId: string
  entityType: 'commitment' | 'intention' | 'marketEntry'
  entityId: string
  addedAt: string
}
```

`ThemeMember` carries `(themeId, entityType, entityId)` as a Dexie compound index for de-duplication on attach and fast member queries.

**Theme progression (computed at render, not stored):**
- For commitments: sum of payments made (toward `targetAmount`)
- For intentions: count by status (researching / committed / acquired)
- For marketEntries: latest observed price summary
- Combined "progress" is rendered as a simple metric strip on the theme detail page; not persisted

### Tag

Free-form folksonomy, multi-value, no own metadata. Stored denormalized as a string array on each entity. Dexie multi-entry index (`*tags`) gives O(log N) "where tag includes X" queries without a join table.

```ts
// On Commitment, Intention, MarketEntry:
tags: string[]   // always present, may be []
```

**Why denorm not a normalized join table:**
- Expected cardinality is tiny (single user, < 50 tags ever)
- Multi-entry index satisfies all read queries
- Snapshot stays simpler — no extra array, no FK to validate
- Tradeoff accepted: global rename is `O(rows)` not `O(1)` — fine at this scale

A normalized `entityTags` table is the upgrade path if real cardinality ever forces it. Schema bump to v4 if so.

## Schema v3

```ts
// src/db/index.ts
this.version(3)
  .stores({
    commitments:   'id, type, startDate, updatedAt, categoryId, *tags',
    payments:      'id, commitmentId, date',
    intentions:    'id, status, updatedAt, categoryId, *tags',  // 'category' free-text dropped
    marketEntries: 'id, intentionId, observedAt, categoryId, *tags',
    settings:      'id',
    categories:    'id, label, sortOrder',
    themes:        'id, label, status, targetDate, updatedAt',
    themeMembers:  'id, themeId, entityId, [themeId+entityType+entityId]',
  })
  .upgrade(async (trans) => {
    // see Migration plan below
  })
```

Index choices:
- `commitments / intentions / marketEntries.categoryId` — drives "filter by category" list views
- `*tags` — multi-entry; drives "filter by tag" list views
- `themeMembers.[themeId+entityType+entityId]` — compound index used both for lookup ("members of theme X") and de-dup on attach
- `themeMembers.entityId` — secondary; drives "themes this entity belongs to" reverse query
- `categories.sortOrder` — picker stable display order; `categories.label` for usage-count lookup on delete
- `themes.status` — Active Themes dashboard tile filter

The old `intentions.category` secondary index is dropped — the field migrates to `categoryId` (see migration). The old `intentions.category` field itself is **removed** in v3, not retained as legacy. Snapshot migration handles back-compat (see snapshot section).

## Migration plan (Dexie v2 → v3)

Single `.upgrade(trans)` block, runs once per device on first open after the v3 build deploys:

```
1. Seed built-in categories table:
     for each of [purchases, travel, skill-development, subscriptions]:
       trans.table('categories').add({
         id: `cat-${slug}`, label,
         sortOrder: 0..3, createdAt: now, updatedAt: now,
       })

2. Backfill commitments and marketEntries:
     for each row:
       row.categoryId = null
       row.tags = []
     (no FK populated — user assigns categories manually post-migration)

3. Migrate intentions.category (free text) → categoryId:
     for each intention:
       const free = (row.category || '').trim().toLowerCase()
       if (free !== '') {
         // try to match a built-in first (case-insensitive label match)
         const builtin = builtIns.find(c => c.label.toLowerCase() === free)
         if (builtin) {
           row.categoryId = builtin.id
         } else {
           // create a user category from the free-text value
           const newCat = { id: generateId(), label: free,
                            sortOrder: 100, createdAt: now, updatedAt: now }
           await trans.table('categories').add(newCat)
           row.categoryId = newCat.id
         }
       } else {
         row.categoryId = null
       }
       row.tags = []
       delete row.category   // drop the v2 field
```

**Idempotency:** Dexie `.upgrade` runs once per version-bump per device (Dexie tracks the resolved version in IndexedDB metadata). Re-running is not possible by design.

**Test fixture:** A v2 DB with 3 intentions (one with `category: 'Travel'` matching built-in, one with `category: 'home gear'` not matching, one with `category: ''`) should produce: builtin matched → `cat-travel` reused, free text → new category, empty → null.

## Snapshot v2 — `data.json` shape change

Bump `schemaVersion: 2`. New top-level entity arrays + extended `recordCounts`:

```jsonc
{
  "schemaVersion": 2,
  "appVersion": "0.2.0",
  "exportedAt": "...",
  "deviceId": "...",
  "recordCounts": {
    "commitments": 3,
    "payments": 17,
    "intentions": 5,
    "marketEntries": 12,
    "categories": 6,
    "themes": 2,
    "themeMembers": 8
  },
  "commitments":   [ /* ...with categoryId + tags */ ],
  "payments":      [ /* unchanged */ ],
  "intentions":    [ /* ...with categoryId + tags, NO 'category' field */ ],
  "marketEntries": [ /* ...with categoryId + tags */ ],
  "categories":    [ /* Category[] */ ],
  "themes":        [ /* Theme[] */ ],
  "themeMembers":  [ /* ThemeMember[] */ ]
}
```

### Forward migration on Restore (v1 → v2)

Restore receives a v1 `data.json` from a device that hasn't upgraded yet. `parseSnapshot` runs the same logic as the Dexie v2→v3 upgrade, against the in-memory snapshot, before returning a v2 snapshot to the caller. Same code path, same test inputs.

```ts
// src/db/snapshot.ts (sketch)
export const CURRENT_SCHEMA_VERSION = 2

export function parseSnapshot(rawText: string): Snapshot {
  const parsed = JSON.parse(rawText)
  if (parsed.schemaVersion === 1) {
    return migrateV1ToV2(parsed)   // new: shared with Dexie upgrade
  }
  // ...existing v2 validation
}
```

`migrateV1ToV2` is exported from a new `src/db/migrations.ts` module so both the Dexie upgrade callback and `parseSnapshot` use it. Single source of truth for the v1→v2 transformation.

### Backward incompatibility

A v3 device cannot Sync to a repo whose `data.json` is currently v1 without first Restoring (which forward-migrates). PUT will overwrite the v1 snapshot with a v2 one — that's fine if the user has Restored first; lossy if they haven't (v1's `intention.category` free text never makes it to v2's `categoryId`).

The L1 conflict modal (`ConflictModal.vue`) covers this: a v3 Sync against a v1 remote sees the sha-mismatch path, opens the modal, user picks "Pull remote first" → migration runs at Restore.

> **Open question Q5 below** asks whether Sync should additionally refuse to overwrite a v1 snapshot without explicit user confirmation, or trust the conflict-modal path.

## Implementation slices

Five slices, each shippable independently. Provisional order — confirm during S0 close.

### S0 — Design *(this doc)*

`docs/L2-ORGANIZATION.md` covering rationale, data model, schema v3, snapshot v2, migration, UI surface, open questions. Resolve Q1–Q5 before S1. No code changes in S0.

### S1 — Categories

- Schema v3 ships (entire migration runs, including theme + themeMember tables — but only categories are surfaced in UI yet)
- `src/db/categorySeed.ts` — built-in seed list
- `src/db/migrations.ts` — `migrateV1ToV2` shared between Dexie upgrade and snapshot Restore
- `src/stores/categories.ts` — Pinia store + liveQuery
- `src/views/CategoriesView.vue` — list + add + rename + archive
- `src/components/CategoryPicker.vue` — dropdown component, used in entity forms
- `CommitmentsView.vue / IntentionsView.vue / MarketView.vue` — picker added to forms; category chip added to row display; filter chip added to list header
- `SettingsView.vue` — link to Categories admin
- `router/index.ts` — `/categories` route
- Snapshot v2 buildSnapshot/parseSnapshot wired (themes still empty arrays in snapshot at this slice)

**Acceptance:** existing rows migrate cleanly; user can add a category, archive it, see it disappear from picker but remain on existing rows; filter intentions by category.

### S2 — Tags

- `src/components/TagInput.vue` — inline tag chip input with auto-suggest from `db.commitments.orderBy('*tags').uniqueKeys()` (similar across stores)
- Tag chip on entity row displays
- Tag filter chip on list views
- No new schema bump — `tags: string[]` already lives on entities from v3 migration

**Acceptance:** can tag an intention with `urgent` and a commitment with `urgent`, filter both list views by `urgent`, rename a tag everywhere via Settings → Tags admin (or manual cross-find/replace if Q3 lands on "no admin yet").

### S3 — Themes

- `src/stores/themes.ts` + `src/stores/themeMembers.ts`
- `src/views/ThemesView.vue` — list of themes with Active Themes section
- `src/views/ThemeDetailView.vue` — theme detail with members across types, progression strip
- `src/components/ThemeAttachMenu.vue` — "Add to theme..." action on entity rows
- Theme CRUD form
- Routes `/themes`, `/themes/:id`

**Acceptance:** create "Cabin Trip" theme with target date, attach a travel intention and a purchase commitment, theme detail shows both as members with their respective metrics, mark a member intention as `acquired` and see progression update.

### S4 — Dashboard surfacing

- `src/components/dashboard/ActiveThemesTile.vue` — active themes (`status === 'active'`) with progress preview
- Category breakdown tile — counts by category across all entity types (or per-type, TBD)
- Replace the existing dashboard's recent-activity section with theme-aware roll-up if it surfaces real value (defer — keep both initially)

**Acceptance:** Dashboard shows active themes with one-glance progress; clicking opens theme detail. Category breakdown reads cleanly on mobile.

### S5 — Sync round-trip validation

- Trigger an intentional 409 by editing `data.json` directly via GitHub web UI on the data repo while the app is offline, then come online and Sync → ConflictModal opens with new fields counted in diff
- Validate v1 → v2 forward migration end-to-end: restore an old v1 snapshot, confirm category mapping + tag empties, re-Sync as v2
- Roll-up tests across all entity types: themes survive Sync round-trip, member references stay intact

**Acceptance:** the Sync conflict scenario L1-S5 deferred is exercised here; v1 forward migration verified live (not just in unit tests).

## UI surface preview

Component placement plan, not visual design:

```
Settings (existing)
  ├─ Connect / Sync / Restore / Disconnect (L1)
  ├─ Categories                              ← S1: link to /categories
  └─ Themes                                  ← S3: link to /themes (also nav)

Nav (top bar)
  ├─ Dashboard
  ├─ Commitments
  ├─ Intentions
  ├─ Market
  ├─ Themes                                  ← S3: new
  └─ Settings

CommitmentsView / IntentionsView / MarketView  (existing list views)
  ├─ Header
  │   ├─ Title
  │   ├─ + New
  │   └─ FilterChips: [ All Categories ▼ ] [ All Tags ▼ ]    ← S1+S2
  ├─ List
  │   └─ Card row
  │       ├─ Existing fields
  │       ├─ Category chip (if categoryId)                   ← S1
  │       ├─ Tag chips (if tags.length)                      ← S2
  │       └─ Action menu adds: "Add to theme..."             ← S3
  └─ Form drawer
      ├─ Existing fields
      ├─ CategoryPicker                                       ← S1
      └─ TagInput                                             ← S2

CategoriesView (new at S1)
  ├─ Built-ins section (locked label, delete refused if in use)
  └─ User categories section (CRUD; delete refuses with usage count + reassign link if in use)

ThemesView (new at S3)
  ├─ Active themes (status === 'active') with member counts
  ├─ Other themes (paused / achieved / cancelled), grouped by status
  └─ + New theme

ThemeDetailView (new at S3)
  ├─ Header: label, status, targetDate, targetAmount, notes
  ├─ Progress strip (computed): commitments, intentions, market
  ├─ Members list (grouped by entityType)
  └─ + Add member dialog (entity type → entity picker)

Dashboard (existing, augmented at S4)
  ├─ Existing summary tiles
  ├─ ActiveThemesTile                                         ← S4
  └─ Category breakdown tile                                   ← S4
```

## Files this design will touch (preview)

New:
- `src/db/categorySeed.ts` — built-in seed list
- `src/db/migrations.ts` — `migrateV1ToV2` shared between Dexie + snapshot
- `src/stores/categories.ts`
- `src/stores/themes.ts`
- `src/stores/themeMembers.ts`
- `src/views/CategoriesView.vue`
- `src/views/ThemesView.vue`
- `src/views/ThemeDetailView.vue`
- `src/components/CategoryPicker.vue`
- `src/components/TagInput.vue`
- `src/components/FilterChip.vue`
- `src/components/ThemeAttachMenu.vue`
- `src/components/dashboard/ActiveThemesTile.vue`
- `src/components/dashboard/CategoryBreakdownTile.vue`

Modified:
- `src/db/schema.ts` — `Category`, `Theme`, `ThemeMember` interfaces; `categoryId` + `tags` on `Commitment` / `Intention` / `MarketEntry`; drop `Intention.category`
- `src/db/index.ts` — `version(3)` + `.upgrade()` callback
- `src/db/snapshot.ts` — `CURRENT_SCHEMA_VERSION = 2`, extended `Snapshot` type, extended `recordCounts`, v1→v2 forward migration on parse, `buildSnapshot` reads new tables
- `src/views/CommitmentsView.vue` — picker, tag input, filter chips, theme-attach action
- `src/views/IntentionsView.vue` — same; remove `category` free-text input
- `src/views/MarketView.vue` — picker, tag input, filter chips, theme-attach action
- `src/views/SettingsView.vue` — Categories link
- `src/views/DashboardView.vue` — Active Themes + Category breakdown tiles (S4)
- `src/router/index.ts` — `/categories`, `/themes`, `/themes/:id`

No changes to `payments` (intentionally — payments inherit category context via parent commitment, no direct categoryId).

## Out of scope at L2 (revisit later)

- Hierarchical categories (parent / child) — start flat; revisit if real lived use surfaces the need
- Soft-archive ("hide from picker without delete") — explicitly out per Q1; revisit in L3 if real usage requires hide-without-delete
- Per-tag color or metadata — tags stay primitive
- Tag rename admin UI — defer to L3 if needed; in L2, rename via per-row edit
- Theme templates / recipes — ship empty themes first
- Theme automations (auto-attach by category match, auto-status from member states) — defer
- Automated category inference from entity text — defer; user-driven taxonomy
- Category color or icon — defer; label-only display
- Multi-select category (entity in multiple categories) — explicitly rejected by the three-layer model. If someone wants a many-to-many "category", that's a Theme.
- Cross-theme dependencies / "Cabin Trip" depending on "Save $5K" — defer indefinitely; out of scope for personal use

## Open question resolutions

Resolved 2026-04-28 in S0 design session. Same discipline as L1 — questions captured + resolved with rationale in the design doc before any S1 code lands.

### Q1 — Category deletion when in use → **Refuse delete**

Options considered:
- (a) **Refuse delete** with "in use by N rows; reassign first" message ✅ **chosen**
- (b) Cascade null on dependents
- (c) Soft-archive only (never hard-delete)

**Resolution:** (a). Explicit reassignment forces the user to decide what the orphaned rows should become rather than silently dropping the categorization signal (b) or accumulating dead picker entries (c). The `archived: boolean` flag originally drafted into the Category schema is **dropped** — it conflated two orthogonal concerns (delete-protection vs hide-from-picker). Hide-without-delete is captured in Out of scope; revisit in L3 if real lived use requires it.

**Implementation note:** Categories admin shows usage count next to each category (cheap query: `db.commitments.where('categoryId').equals(id).count()` × 3 entity types). Delete button disabled with tooltip when count > 0; clicking the count opens the relevant filtered list view.

### Q2 — Theme status: explicit field or derived → **Explicit field**

Options considered:
- (a) **Explicit `status` field** the user sets ✅ **chosen**
- (b) Derived status computed from member states

**Resolution:** (a). Themes can encompass long-running goals where "achieved" is a user judgement, not a member-state aggregate. "Cabin Trip" might be done even if some optional member intentions stay `dropped`; "Save $5K" might not be achieved even when every contributing payment is made if the user later raised the target. Matches Linear Project status, Notion status property, Things "completed" project pattern. Members carry their own state independently.

**Status values:** `'active' | 'paused' | 'achieved' | 'cancelled'`. Default on create: `active`. No automatic transitions.

### Q3 — Tag rename / consolidation UX in L2 → **Per-row edit only**

Options considered:
- (a) **Per-row edit only** in L2; auto-suggest at input time reduces divergence ✅ **chosen**
- (b) Settings → Tags admin in L2 with rename-everywhere action

**Resolution:** (a). At expected cardinality (single user, < 50 tags ever) per-row is acceptable. The TagInput auto-suggest pulls existing tag values from `db.{table}.orderBy('*tags').uniqueKeys()` so divergence is reduced at input time. Tags admin (rename-everywhere, usage counts, color) is captured as an L3 follow-up if real friction emerges.

### Q4 — `Intention.category` free-text field → **Drop entirely in v3**

Options considered:
- (a) **Drop the field entirely** in v3 ✅ **chosen**
- (b) Retain as legacy field alongside `categoryId`

**Resolution:** (a). Single source of truth. The Dexie v2→v3 upgrade callback logs the mapping per row (one-time `console.info` on first open after upgrade) so the user can audit if any string mis-maps; reversal is via Categories admin (rename or reassign). Keeping a legacy field tempts the UI to display both, defeats normalization. Snapshot v1 → v2 forward migration covers Restore-side back-compat for devices receiving an older `data.json`.

### Q5 — Sync v3 against v1 remote → **Trust conflict modal**

Options considered:
- (a) **Trust the existing conflict-modal flow** ✅ **chosen**
- (b) Add a pre-flight schemaVersion check on Sync

**Resolution:** (a). The conflict modal already has "Pull remote first" wired (L1-S4); adding a pre-flight branch creates a second path with same outcome and more code in L2. **Mitigation enrichment:** when ConflictModal renders, if `remoteSnapshot.schemaVersion < CURRENT_SCHEMA_VERSION`, surface an extra line in the modal copy — *"Remote snapshot is from an older app version. Recommend Pull remote first to migrate; Overwrite will replace the older snapshot with your current data."* — and weight the action button styling so "Pull remote first" reads as the primary action in this case. Risk if user picks Overwrite anyway: other v1 devices' free-text `category` data is lost (those devices haven't yet upgraded so haven't yet mapped to `categoryId`); user is informed in the modal copy.
