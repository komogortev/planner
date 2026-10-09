# H1 — Entries & capture (Design)

**Status: S0 draft, 2026-10-08. Open questions unresolved — no S1 code until §7 is closed.**
Terms per [VOCABULARY.md](VOCABULARY.md); invariants per [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Goal

Writing something down on the phone takes two taps and works offline. Entries land in the Inbox when no category is
given, carry tags, and sync across devices **without losing an entry written on either device**. The financial screens
leave the navigation.

**Acceptance.** One week of daily capture on the phone, organising on the desktop. At the end, every entry written on
either device is present on both. An intentional conflict (edit `data.json` on github.com while a device is offline,
then sync) resolves without losing an entry. Old financial data is still present and reachable by URL.

## 2. Scope

| In | Out (tier) |
|---|---|
| `entries` table (Dexie v4), snapshot v3 | Lenses, slices, reports (H2) |
| `Category.rule` field + editor in Categories | AI anything (H2+) |
| Capture surface (FAB / capture-first home), Inbox view, entry list with category + tag filter chips | Themes UI, theme membership for entries (H4) |
| Tag input with auto-suggest from existing tags | Tasks (H4) |
| Financial screens out of the nav (routes kept) | Markdown rendering of entry bodies (later) |
| Install-prompt mount race fix + "show install button again" | Auto-sync, push notifications (H5) |
| Conflict handling that cannot drop entries (§7 Q8) | |
| Intentional 409 exercised (carried from L2-S5) | |

## 3. Data model — draft

```ts
interface Entry {
  id: string                    // uuid
  body: string                  // owner text; plain text with line breaks in H1
  createdAt: string             // ISO datetime = capture time (same name as every other table)
  occurredAt: string | null     // YYYY-MM-DD when the event date differs from capture ("yesterday's call")
  categoryId: string | null     // null = Inbox
  tags: string[]                // always present, may be []
  origin: 'author'              // A1; entries are always owner-written
  updatedAt: string
}

// Category gains one field (no index):
interface Category { /* shipped fields */ rule: string /* '' = no rule */ }
```

Dexie v4 stores (unchanged tables omitted from the diff only for reading; the real block repeats them all):

```
entries:    'id, createdAt, occurredAt, categoryId, *tags, updatedAt'
categories: 'id, label, sortOrder'          // unchanged index; rows backfilled rule = ''
```

## 4. Migration plan

- **Dexie v3 → v4:** add `entries`; `categories.toCollection().modify(c => { c.rule ??= '' })`. No other table changes.
- **Snapshot v2 → v3** (`CURRENT_SCHEMA_VERSION` 2 → 3): add `entries: []`, `recordCounts.entries`, `rule` on each
  category. The per-row backfill lives in `src/db/migrations.ts` and is called by both paths (A9).
- **Old app vs new snapshot:** a v2 app refuses a v3 snapshot (`newer-version`, shipped). The PWA auto-updates on next
  load; the refusal copy should say "reload to update".
- **Fresh installs** skip upgrade callbacks; anything seeded must also be ensured at boot (the `ensureBuiltIns`
  lesson from L2-S1).

## 5. UI surface — draft

- **Capture:** one text field, focused on open; optional category chip row and tag input below; Save. FAB on every
  list view opens it.
- **Inbox:** entries with no category, newest first; tap → assign category / tags; multi-select bulk assign.
- **Entries:** all entries, filter chips for category and tag, time-grouped.
- **Categories:** existing admin gains a "Rule" textarea per category.
- **Nav:** Capture/Inbox · Entries · Categories · Settings. Commitments, Intentions, Market keep their routes, out of
  the nav.

## 6. Files this design will touch (preview)

`src/db/schema.ts` · `src/db/index.ts` (v4) · `src/db/migrations.ts` · `src/db/snapshot.ts` (v3) ·
`src/db/syncTracking.ts` (dirty hooks on `entries`) · new `src/stores/entries.ts` · new views `CaptureView.vue`,
`InboxView.vue`, `EntriesView.vue` · new `TagInput.vue` · `CategoriesView.vue` · `src/router/index.ts` · `App.vue`
nav · `src/main.ts` (install-prompt capture before mount) · tests for migration, snapshot round-trip, merge.

## 7. Open questions

Each carries the default S1 would proceed under.

| # | Question | Default |
|---|---|---|
| Q1 | Home route: capture-first (`/` = Capture + Inbox) or keep the Dashboard | **Capture-first (Recommended)**; Dashboard retires with the financial screens |
| Q2 | Frozen screens: out of nav with routes kept, or routes removed | **Out of nav, routes kept (Recommended)**; reachable from Settings → "Archived screens" |
| Q3 | Seed entry categories (Work, Home, Health…) or start from the Inbox | **No new seeds (Recommended)**; existing built-ins stay; the owner creates categories, H4 curation proposes them |
| Q4 | Entry edit history | **Overwrite + `updatedAt` (Recommended)**; the data repo's git history is the revision record |
| Q5 | May the owner delete an entry? | **Yes, with confirm (Recommended)**; reports (H2) store the cited quote so a deleted entry doesn't empty them. The AI never deletes (A6) |
| Q6 | `occurredAt` granularity | **Date only (Recommended)** |
| Q7 | Body format | **Plain text with line breaks in H1 (Recommended)**; markdown rendering later |
| Q8 | **Conflicts can now lose entries.** L1 sync is whole-snapshot: on a 409, "Pull remote first" replaces local (unsynced phone entries are gone) and "Overwrite remote" drops the other device's work. Capture on two devices makes this the normal case, not the rare one | **Record-level merge in H1 (Recommended)**: on 409, union both sides by `id`, newer `updatedAt` wins per record, deletions carried as tombstones (`deletedIds` + time) so a delete isn't resurrected. Replaces the choice modal for the no-overlap case; the modal stays for same-record edits. Supersedes the 2026-04-26 "snapshot + last-write-wins is the floor" scope line |
| Q9 | Employer content in a Work category | **Owner decision** (workspace direction doc D8). Default: personal obligations around work only, no employer content |
