# H1-S2 — Backend

**Status: started 2026-10-10.** Slice S2 of [H1-ENTRIES.md](H1-ENTRIES.md) §13. Builds on the S1 `api/` skeleton
(Hono + own OAuth + `users`/`identities`/`sessions`). Budget: ~3 sessions. Cost: $0.

**Done when:** the worker tests for every §10 backend row are green, each with its negative control shown failing
first; the Worker is deployed; the S1 CPU re-entry is read (≥ 50 callbacks, p99 ≤ 7 ms).

## Steps

| # | Work | Evidence |
|---|---|---|
| 0 ✅ | **Test harness.** `@cloudflare/vitest-plugin` (tests run in workerd with a local D1; each test starts from an empty, freshly migrated database; provider calls stubbed through `globalThis.fetch`). `pnpm test:api` | Sign-in gate: allowlisted → one user + session + echoed nonce; not invited → 403 and **0 rows**; forged state → 400. Known positive: with the allowlist check removed, the not-invited test fails |
| 1 ✅ | **Shared domain:** `src/domain/entry.ts` (Entry type) + `src/domain/clean.ts` (§7), imported by the app and the Worker | §10 *Cleaning*: control chars stripped, 20,001 chars rejected, unknown fields dropped |
| 2 ✅ | **Migration `0004`:** `users.version_seq`, `invites`, `entries` (PK `(user_id, id)`), `entry_revisions`, indexes | migrates on an empty DB and on a copy of production's schema |
| 3 ✅ | **Invites replace `ALLOWED_EMAILS`:** single-use, bound to a verified email, expiring; `api/scripts/invite.mjs` (create · list · revoke) over `wrangler d1 execute`; revoke deletes that user's sessions; `POST /auth/logout`; expired sessions purged at sign-in | §10 *Invite gate* (negative control); revoked user's token → 401 |
| 4 | **Sync:** one data-access module taking `userId` as a required argument; `POST /sync/push` (§6.1, ≤ 100, idempotent, §6.3 revisions), `GET /sync/pull` (§6.2), `GET /entries` (date range + `LIKE`, §12 Q7); session renewed on each successful sync (§8) | §10 *Push idempotency*, *Isolation*, *Stale-base edit keeps text*, *Delete is not resurrected*; foreign `user_id` in a payload ignored |
| 5 | **Rate limit** per user and per IP on `/auth/*` and `/sync/push` (Workers rate-limiting binding; confirm free-plan availability first) | 429 after the limit, in a test |
| 6 | **Auth items carried from S1** ([H1-S1-SPIKE.md](H1-S1-SPIKE.md) §5): Google auto-link only for `@gmail.com` or tokens with `hd`; PKCE for GitHub if its OAuth Apps accept it; flow cookie named per `state` | a test per rule |
| 7 | **Deploy + read:** `0004` remote, Worker deploy; CPU over ≥ 50 callbacks; check browser history and Worker logs for `token=` | §6-style table in this doc |

Order: 1 → 2 → 3 → 4 are sequential; 5 and 6 can land in any order after 3.

## Decisions (Claude, under the owner's 2026-10-10 delegation — reversible)

- **Schema follows S1, not the spec's draft:** provider identities live in `identities` (one user, many providers),
  so `users` gains only `version_seq`. H1 §5.2 is amended to match.
- **The client moves to its own origin at S4** (Cloudflare Pages, free, `*.pages.dev` — on the public suffix list, so
  no other site shares its storage). `komogortev.github.io` hosts every Pages site the owner has, and any of them could
  read a bearer token kept there (S1 session-2 review). This amends H1 §12 Q8's "stay on `github.io`"; its point (no
  custom domain, bearer tokens over cookies) stands. Until S4 the token reads only `/me`.
- **Worker tests live in `api/test/` under `api`'s own vitest 4**; the app's `vitest --dir src` (v2) never sees them.

## Results

| Step | Result |
|---|---|
| 0 | Harness live (#16). `vitest-pool-workers` turned out deprecated after install → `@cloudflare/vitest-plugin` 1.4 |
| 1 | `src/domain/{entry,clean}.ts`; 25 app tests + 1 workerd parity test. Review changed the contract: **push payloads are the full entry** (missing field = error, so a partial edit cannot wipe tags or undelete); strip controls *before* NFC (else `e\u0000́` stays decomposed — checked); cleaning idempotent; lone surrogates refused; timestamps exactly `toISOString()` (V8 rolls `02-30` to `03-02` — checked); work bounded before normalising; `categoryId` charset. 11 mutations: 10 caught, 1 equivalent (the round-trip check alone enforces the strict format; removing it is caught) |
| 2 | `0004`: `users.version_seq` + `disabled_at`, `invites` (keyed by email — the provider's verification is the proof, so no code to hand around), `entries`, `entry_revisions`. Tests: full schema on an empty DB; production-shaped DB (0001–0003 + account + session) upgrades keeping both. A destructive line in `0004` is caught. Applied to local D1 |
| 3 | `ALLOWED_EMAILS` → invites. New account = one conditional D1 batch (no open invite → nothing written; racing sign-ins → one account). Revoke = `disabled_at` + sessions deleted, refused at sign-in and on every request. `POST /auth/logout`; expired sessions purged at sign-in. `api/scripts/invite.mjs create/list/revoke` (local default, `--remote` explicit; says what it matched, refuses a no-op revoke; `create` on an existing account only lifts a revocation). 12 auth tests incl. the production shape (account with no invite row) and revoke via a second provider; 6 mutations, all caught. Production checked: 1 account, email stored lowercase. Review: nothing blocking; link race → `INSERT OR IGNORE`. Known gap: inviting two addresses of one person leaves the second invite open |
