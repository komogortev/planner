# Google Sheets Structure — Personal Planner

Until L1 sync ships, you can create + fill the target spreadsheet by hand. When L1 lands, the app will read/write this exact structure, so data you enter now is not throwaway — it becomes the seed for `Restore from Sheets`.

## Workbook

- **Name:** `Personal Planner Data`
- **Location:** your own Google Drive (any folder). L1 uses the `drive.file` scope, so the app will only see this file after you pick it via Google Picker.
- **Tabs (4):** `commitments`, `payments`, `intentions`, `market_entries` — names are lowercase, match Dexie tables 1:1.
- **Row 1 of every tab:** column headers in the exact order + spelling shown below. Case matters — camelCase preserved so L1 sync is a straight field read/write with no mapping.

## Global conventions

| Topic | Rule |
|-------|------|
| `id` | Any stable string you won't reuse. Short slug (`mortgage-01`, `car-2027`) is fine; UUIDs also work. Once referenced by another row, never rename it. |
| Date fields (`startDate`, `date`, `observedAt`) | `YYYY-MM-DD`, e.g. `2026-04-22`. Format the column as Plain text so Sheets doesn't auto-convert to a serial number. |
| Timestamp fields (`createdAt`, `updatedAt`) | ISO 8601 with time + Z, e.g. `2026-04-22T14:30:00Z`. If you don't want to bother, use the date at midnight UTC — `2026-04-22T00:00:00Z`. |
| Numbers | Plain numbers. No `$`, no `%`, no thousands separators. `0.045` not `4.5%`. |
| `notes` | Free text, can be blank. |
| Empty vs. blank | Leave truly unset fields blank. Don't type `null` or `—`. |
| Enums | Values must match exactly (lowercase, hyphens where shown). See per-tab tables. |

## Tab 1 — `commitments`

Fixed obligations: mortgages, loans, subscriptions.

| Column | Type | Required | Allowed values / format | Example |
|--------|------|----------|--------------------------|---------|
| `id` | string | yes | stable slug/UUID | `mortgage-house-01` |
| `type` | enum | yes | `mortgage` \| `loan` \| `subscription` \| `other` | `mortgage` |
| `label` | string | yes | — | `House mortgage` |
| `startDate` | date | yes | `YYYY-MM-DD` | `2025-09-01` |
| `principal` | number | yes | initial amount borrowed, positive | `350000` |
| `annualRate` | number | yes | decimal, not percent | `0.0475` |
| `termMonths` | integer | yes | total term length | `300` |
| `paymentDay` | integer | yes | day of month, `1`–`31` | `15` |
| `notes` | string | no | — | `fixed rate, no prepayment penalty` |
| `createdAt` | timestamp | yes | ISO 8601 | `2026-04-22T00:00:00Z` |
| `updatedAt` | timestamp | yes | ISO 8601 | `2026-04-22T00:00:00Z` |

**Subscriptions:** use `termMonths` = number of months you expect to keep it (e.g. `12` for an annual plan). `annualRate` = `0` if no interest.

## Tab 2 — `payments`

Actual logged payments against a commitment.

| Column | Type | Required | Allowed values / format | Example |
|--------|------|----------|--------------------------|---------|
| `id` | string | yes | stable slug/UUID | `pay-mortgage-2026-04` |
| `commitmentId` | string | yes | must match a `commitments.id` | `mortgage-house-01` |
| `date` | date | yes | `YYYY-MM-DD` | `2026-04-15` |
| `amount` | number | yes | total paid, positive | `1824.50` |
| `principalPortion` | number | optional at this stage | see note below | `824.50` or blank |
| `interestPortion` | number | optional at this stage | see note below | `1000.00` or blank |
| `balanceAfter` | number | optional at this stage | see note below | `349175.50` or blank |
| `notes` | string | no | — | `extra $200 toward principal` |
| `createdAt` | timestamp | yes | ISO 8601 | `2026-04-22T00:00:00Z` |

**Note on the three derived fields** (`principalPortion`, `interestPortion`, `balanceAfter`). In the app these are computed from the amortization schedule + prior balance when the payment is logged. For the manual-sheet phase:
- If you know them, fill them in.
- If not, leave blank. When L1 `Restore from Sheets` lands, the restore path should recompute them from the commitment schedule. (Open question — flagged in `STATE.md` → Blockers.)

## Tab 3 — `intentions`

Mid-horizon plans with explicit lifecycle.

| Column | Type | Required | Allowed values / format | Example |
|--------|------|----------|--------------------------|---------|
| `id` | string | yes | stable slug/UUID | `ebike-2027` |
| `label` | string | yes | — | `Commuter e-bike` |
| `category` | string | yes | free text, keep consistent (`transport`, `tools`, `travel`, `home`…) | `transport` |
| `targetBudget` | number or blank | no | your target spend, or blank if undecided | `2500` |
| `status` | enum | yes | `considering` \| `researching` \| `committed` \| `acquired` \| `dropped` | `researching` |
| `notes` | string | no | — | `waiting for 2027 models` |
| `createdAt` | timestamp | yes | ISO 8601 | `2026-04-22T00:00:00Z` |
| `updatedAt` | timestamp | yes | ISO 8601 | `2026-04-22T00:00:00Z` |

**`targetBudget` blank** = "no target set yet". Do not use `0` — that means "budget is zero".

## Tab 4 — `market_entries`

Append-only price/availability log per intention. One row per observation — never edit, never delete.

| Column | Type | Required | Allowed values / format | Example |
|--------|------|----------|--------------------------|---------|
| `id` | string | yes | stable slug/UUID | `obs-ebike-2026-04-22-canyon` |
| `intentionId` | string | yes | must match an `intentions.id` | `ebike-2027` |
| `observedAt` | date | yes | `YYYY-MM-DD` | `2026-04-22` |
| `pricePoint` | number | yes | price at time of observation | `2799` |
| `source` | string | yes | store / site / seller | `canyon.com` |
| `availability` | enum or blank | no | `in-stock` \| `limited` \| `unavailable` \| blank | `in-stock` |
| `notes` | string | no | — | `free shipping promo` |
| `createdAt` | timestamp | yes | ISO 8601 | `2026-04-22T00:00:00Z` |

**Append-only discipline.** Treat this tab like a ledger. The app's sparkline trend reads from the full history — editing or deleting rows loses signal. If a price was wrong, add a correcting row with a note instead.

## Cross-tab relationships

```
commitments.id  ←  payments.commitmentId
intentions.id   ←  market_entries.intentionId
```

If you change a commitment or intention `id`, you have to update every row that references it. Simpler to pick an id you'll live with.

## Setup checklist

1. Create a new Google Sheet named `Personal Planner Data`.
2. Rename the default tab to `commitments`. Add 3 more tabs: `payments`, `intentions`, `market_entries`.
3. On each tab, paste the column names from the table above into row 1 (exact spelling + order).
4. Select the date columns (`startDate`, `date`, `observedAt`) → Format → Number → **Plain text**. Same for `id` columns if you want to be safe against auto-format.
5. (Optional) Freeze row 1: View → Freeze → 1 row.
6. (Optional) Data validation on enum columns:
   - `commitments.type` → one of: `mortgage, loan, subscription, other`
   - `intentions.status` → one of: `considering, researching, committed, acquired, dropped`
   - `market_entries.availability` → one of: `in-stock, limited, unavailable` (allow blank)
7. Start entering real data.

## When L1 sync ships

- `Sync now` will overwrite all four tabs with a snapshot of your local Dexie state. If you've been entering data only in the sheet, hit `Restore from Sheets` first — otherwise the first `Sync now` wipes your manual entries.
- `Restore from Sheets` replaces local state with the sheet contents. Recomputation of derived payment fields is TBD — see STATE.md blockers.
- Put the file somewhere in your Drive now so it's ready to pick when L1 lands. Don't share it — `drive.file` scope means the app only sees what you explicitly open via Picker.
