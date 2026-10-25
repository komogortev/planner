# Runbook — run, test, deploy

Commands run from `E:/Projects/apps/personal-planner`. There is no staging environment: **local** and **production**.

## Which environment am I looking at?

| | App | API tab (`/health`) |
|---|---|---|
| **Local dev** | amber `LOCAL DEV` banner, amber header rule + favicon + Android status bar, tab `[LOCAL DEV] …` | amber `API` favicon |
| **Preview** (production build on localhost) | fuchsia `PREVIEW BUILD` banner, fuchsia rule + favicon + status bar, tab `[PREVIEW BUILD] …` | — none. Its API calls go to production, which refuses `localhost:4173` (CORS) — so sign-in does not work in preview. Use it for the built app itself: offline, install, deep links, bundle |
| **Production** | the real look — no banner, real favicon, plain title | the app's real favicon |

Decided at runtime from the host (`src/env/appEnv.ts`), so the exact build that ships is the one tested.

## Local

| What | How | Link |
|---|---|---|
| App (dev, hot reload) | launch config `personal-planner` | http://localhost:5176/planner/ |
| Sign-in gate | signed out → tap the orange ring over the pocket button (needs the API row below running, and an invite in the local D1) | http://localhost:5176/planner/signin |
| Skip sign-in while iterating on screens | `VITE_SKIP_AUTH=1 pnpm dev` (dev builds only) | — |
| API (Worker, local D1) — **must be running for local sign-in** | launch config `planner-api` | http://localhost:8787/health |
| App as built for production | `pnpm build`, then launch config `personal-planner-preview` | http://localhost:4173/planner/ |

| Check | Command | What it covers |
|---|---|---|
| Everything offline | `pnpm check` | typecheck (app + api) · app unit tests · Worker tests in workerd with a fresh D1 per test |
| App tests only (watch) | `pnpm test` | `src/**` |
| Worker tests only | `pnpm test:api` | `api/test/**` |
| Smoke the running local stack | `pnpm smoke:local` | both launch configs running; same 13 checks as production |

**CI:** `.github/workflows/ci.yml` runs `pnpm check` on every PR and every push to `main` — the PR shows a green or red
**CI / check**. Red is a stop: never merge over it.

Local sign-in needs an invite in the **local** D1 (the `.wrangler/` state):
`node api/scripts/invite.mjs create <email>` · `list` · `revoke <email>`.

## Parallel sessions

One session, one worktree off `origin/main` (`git worktree add E:/Projects/apps/planner-wt-<tag> origin/main`, a short
path). Never `git switch` in the shared checkout. After creating one, run `pnpm install --frozen-lockfile` and
`pnpm --dir api install --frozen-lockfile`. Sign-in works only from `http://localhost:5176/planner/` (the API's
allow-list); other ports can test UI with a planted token but cannot sign in. A full dev pair on other ports: the Worker with
`wrangler dev --port 8788 --var ALLOWED_APP_URLS:http://localhost:5179/planner/ --var APP_ENV:local --var MODEL_KEY_SECRET:<the dev value in api/package.json>`
and the app with `VITE_API_URL=http://localhost:8788` on port 5179 (`src/auth/signIn.ts`; launch entries `planner-wt-s2-api` / `planner-wt-s2`).
Plant a token by inserting a `users` + `sessions` row in that worktree's local D1 (`sessions.token_hash` = base64url SHA-256 of the token)
and `localStorage['planner.signIn.token']`. The Browser pane allows five dev servers per
folder: stop the ones whose branch has merged. A worktree cannot be deleted while
`planner-api` runs (a hardlinked `workerd.exe`).

## Production

| What | Link |
|---|---|
| App (Cloudflare Pages, builds `main` on push; project `koplanner`) | https://koplanner.pages.dev/ |
| Old address (GitHub Pages) — only the "moved" notice; the Worker refuses it (phase 5) | https://komogortev.github.io/planner/ |
| Sign-in gate | https://koplanner.pages.dev/signin |
| API health | https://planner-api.komogortev.workers.dev/health |
| App deploys (GitHub Actions → Pages) | https://github.com/komogortev/planner/actions |
| Worker, logs, D1 | https://dash.cloudflare.com → Workers & Pages → `planner-api`; D1 → `planner` |

| Check | Command |
|---|---|
| Smoke production (read-only, 13 checks incl. refusals) | `pnpm smoke` |
| Live Worker logs | `pnpm --dir api exec wrangler tail` |
| Invites in production | `node api/scripts/invite.mjs list --remote` (`create` / `revoke` likewise) |

## Deploy

Production only ever runs what is on GitHub's `main`. The app builds from `main` on GitHub; the Worker and D1 deploy
from this machine, so a guard enforces the same rule there.

1. **Merge the PR** → GitHub Actions builds and publishes the app to Pages (~1 min).
2. **`git switch main && git pull --ff-only`**, then **`pnpm --dir api run deploy`** — applies pending D1 migrations, then
   uploads the Worker tagged with the commit (`wrangler deployments list` shows `abc1234 <subject>`). It **refuses**
   on uncommitted or untracked files, a branch other than `main`, or `main` differing from `origin/main`.
   Migrations alone: `pnpm --dir api run db:migrate:remote` (same guard).
   **Order when a change adds a record kind or a table the client writes (HW-HARNESS S3 onwards): Worker and migration first, client second.** Pages builds from `main` by itself; an older Worker answers a record push with `rejected`, and the client keeps refused rows until Retry.
3. `pnpm smoke` — a minute after the Worker deploy, not at once: on 2026-10-11 the new check failed seconds after `deploy` and passed about a minute later (the new version taking a moment to reach the edge). Run it again before calling it red.

Between steps 1 and 2 the new app runs against the old Worker for a minute or two. That is fine while every Worker
change is backwards compatible with the app before it — keep it so (add, don't rename; the app tolerates a missing
field). Roll back the Worker: `pnpm --dir api exec wrangler rollback`. D1 migrations have no down step; the undo is
D1 Time Travel (point-in-time restore of the whole database), so migrations only add.

The app has a one-way door on each device too. Dexie 4 does **not** refuse an older build: it reopens the newer database,
adds what the older schema expects and runs on, writing and syncing newer data, and the newer build's upgrade steps do
not run again when it returns (measured 2026-10-14, D-118). Since A6 a build older than the device's data opens nothing
and shows "Please update the app" (`src/db/staleBuild.ts`, checked before Dexie opens). **Rollback floor: never roll Pages
back to a build without `src/db/staleBuild.ts`** (it has no guard). Past a Dexie bump, a rollback still blocks every
device that already has the newer data until the fix is out, so fix forward.
Last bump: v7 (financial tables dropped, D-112).

Secrets: production via `pnpm --dir api exec wrangler secret bulk <file>` (then delete the file); local in `api/.env`,
which only the owner edits.

**`MODEL_KEY_SECRET` (H5, encrypts users' model API keys — [H5-MODELS.md](H5-MODELS.md) §6 — and, since G1, their
connected GitHub tokens — [GITHUB-BRIDGE.md](GITHUB-BRIDGE.md) §4).** 32 random bytes, base64. **Never regenerate it once
set:** every stored model key and GitHub token stops decrypting, and each user must paste them again.
Without it, saving a model key, connecting GitHub and every model call answer 503 `not configured`; nothing else breaks. Create it so the
value is never printed (run from `apps/personal-planner`):

```bash
node -e "require('fs').writeFileSync('api/.env.production','MODEL_KEY_SECRET='+require('crypto').randomBytes(32).toString('base64'))"
pnpm --dir api exec wrangler secret bulk .env.production
```

Node writes the file itself: a shell redirect (`> file`) in Windows PowerShell 5.1 writes UTF-16, which wrangler refuses
("Configuration file contains UTF-16 LE byte order marker"; seen 2026-10-12). The same holds for any secrets file made by
redirect: write it with Node, or save it as UTF-8 in an editor.

Then delete `api/.env.production`. Check by name only: `pnpm --dir api exec wrangler secret list`. **Never rotate it by
overwriting**: every stored key was sealed with it and would stop opening (each would read as `no_key` until re-entered).
A rotation adds a second secret and `key_version` 2 (`api/src/keyBox.ts`). Local dev: add the same line, with its own
value, to `api/.env`.

## Nightly export (R6, A11)

A cron (`api/wrangler.toml` `[triggers]`, 07:17 UTC) writes **one account** (D-122 Q1) to the private repo in
`EXPORT_REPO` (`komogortev/planner-data`) as one commit on its default branch: `export/entries/<YYYY-MM>.json` per month of
`createdAt` with that month's revisions, `export/records.json`, `export/account.json` (models and integrations without key
columns, as in the Settings export) and `export/meta.json` (cursor, months, counts). Everything else in the repo is left
alone; a file under `export/` that is no longer produced is removed. A night with no change sends nothing and makes no
commit, so the commit history is the change log. Code: `api/src/nightlyExport.ts`.

Two secrets, set together (`wrangler secret bulk`, as above):

- `EXPORT_GITHUB_TOKEN`: a fine-grained token, **Only select repositories → `planner-data`**, permission **Contents: Read
  and write** (Metadata read is added by GitHub). When it expires, every night logs `export.github-401`.
- `EXPORT_ACCOUNT_EMAIL`: the email of the one account to export. No match logs `export.no-account`; nothing is sent.

Failures land in `error_log` with route `/cron/export` (query in "Error log" below). Kinds: `export.not-configured`
(a secret is missing; this row every night is also proof that the cron fires), `export.no-account`, `export.many-accounts`,
`export.bad-repo`, `export.github-<status>` (`422` = the branch moved during the run; the next night retries),
`export.github-unreachable`, `export.tree-truncated` (the `export/` listing was too large to read; no commit is made),
`export.failed` (anything else). A CPU-limit kill leaves **no** row: if the repo has no commit for days while notes were
written, read the cron's invocations in the Cloudflare dashboard (Workers → planner-api → Logs/observability, `cpuTime`).
The repo must have at least one commit (a new empty repo answers 409 on its ref).

## Break-glass: set a Task state without a session

When no app session or token is at hand, `api/scripts/task-state.mjs` writes the state change the way the push route would
(`records.ts`): it bumps `users.version_seq`, keeps the replaced row in `record_revisions`, and updates the record on the new
version, guarded by the version it read. Every device pulls it on the next sync. Dry run by default; `--apply` writes;
`--remote` targets production. Run it from `api/` with `wrangler` logged in to the account that owns the planner database.

```
node scripts/task-state.mjs <email> <taskIdPrefix...> --state done --remote
node scripts/task-state.mjs <email> <taskIdPrefix...> --state done --remote --apply
```

It reads the rows first, skips a task already in the state, stops on an unknown or ambiguous id, and re-reads every row after
the write (`OK` or `NOT APPLIED`). Tested on a local database only: apostrophes in the text, the version moving, the old row
kept, a second run writing nothing. The normal path stays the app; use this one rarely.

## Before and after a D1 restore (Time Travel, A7)

**What a restore is.** `wrangler d1 time-travel restore planner --timestamp=<ISO>` (or `--bookmark=`) rewinds the **whole
database, every account at once**. Queries in flight fail. It can itself be undone: its output prints the bookmark to go
back to. **Retention: 7 days on the Workers Free plan (this account), 30 on Paid** (Cloudflare docs, read 2026-10-14). The
database was created 2026-10-10, so only the positive side is measured: a bookmark resolves back to the creation day. A
timestamp before creation fails with an opaque `internal error 7500`, and a timestamp past retention may fail the same way.
Still to measure, on or after 2026-10-18: `time-travel info planner --timestamp=<now − 8 days>` should fail and
`<now − 6 days>` should answer.

**Before restoring: what would this undo?** Read-only. `T` = the restore time in epoch ms:

```
pnpm --dir api exec wrangler d1 execute planner --remote --command "SELECT (SELECT COUNT(*) FROM users WHERE created_at > T) AS accounts_created, (SELECT COUNT(*) FROM deleted_tokens WHERE deleted_at > T) AS deleted_account_tokens, (SELECT COUNT(*) FROM invites WHERE created_at > T OR used_at > T) AS invites_changed, (SELECT COUNT(*) FROM models WHERE updated_at > T) AS models_changed, (SELECT COUNT(*) FROM sessions WHERE created_at > T) AS sessions_created"
```

| Count above 0 | After the restore | Who acts |
|---|---|---|
| `deleted_account_tokens` | **An account deleted after T comes back with its notes.** The record of the deletion is rewound too, so nothing marks it afterwards | Pick a later T. Otherwise list the affected accounts **before** restoring and ask each person to delete again |
| `accounts_created` | An account created after T is gone; its devices are signed out but keep their notes (a 401 never wipes, D-04/D-55) | Re-issue the invite if it was created after T; signing in again with a new account is unverified for those devices |
| `invites_changed` | Invites created after T are gone; ones used after T are open again | Owner re-issues or revokes (`invite.mjs`) |
| `models_changed` | A model added after T is gone; one edited after T is back to its old key (a revoked key returns) | Each tester re-adds or re-checks their model in Settings |
| `sessions_created` | Sign-ins after T are gone: those devices show signed out, notes kept. A device signed out from Settings after T is signed in again | Testers sign in again, and repeat any "sign out a device" since T |

**What heals by itself (D-58).** A pull whose `head` is below the device's cursor, or a push given a version at or below
it, starts a sweep from 0. Notes and records the server lost are uploaded again from the devices that still hold them.

**Edits acknowledged after T** (since A8, 2026-10-16): a note or record the server returns below the version a device
acknowledged for it is the restored copy; the device's edit (a Task done, an answer, a removal) is uploaded again on the
server's version (`src/sync/sweep.ts`). Only from a device that still holds it, and it arrives when that device next syncs.
Limit: a row another device edited after T at a lower version number is overwritten by the older edit; the server keeps a
revision.

**What does not heal:**
- `users.version_seq` edited by hand: set it to **at least `max(server_version)` of that account**. Below it, every device
  sweeps again on every poll.
- Server-only logs: `ai_calls` (the daily model cap counts from it) and `error_log` lose the window. Harmless.

## Error log (S4, D-24)

The app reports `js-error`, `promise-rejected`, `sync-stuck` (a sync failing three times in a row) and `stale-build` (a build older than the device's data, A6; once per device per stored version) to `POST /log`:
error kind, app route, build id, time — no message, no text, no account. Production builds only, one report per kind per
minute, its own per-address limit (10/min), at most 200 reports a day from everyone together (A5), newest 500 kept. Read it:

```
pnpm --dir api exec wrangler d1 execute planner --remote --command "SELECT datetime(at/1000,'unixepoch') AS utc, kind, route, build FROM error_log ORDER BY id DESC LIMIT 50"
```

## Cloudflare Pages project `koplanner` (the app's host)

Settings that matter (dashboard → Workers & Pages → `koplanner` → Settings → Build): command `pnpm build`, output `dist`,
`NODE_VERSION=20`, `PNPM_VERSION=10`. **Branch control: production branch `main`, "Enable automatic production branch
deployments" ON, preview branch NONE** (owner, 2026-10-11) — so PRs get no `*.koplanner.pages.dev` URL and no Cloudflare
check; the required check is CI (`check`) only. Turning the production box off silently stops `main` from deploying: if the app
is stale after a merge, look there first (`version.json` on the app vs `git rev-parse --short origin/main`; smoke checks it).
A Cloudflare-only build problem (the kind a branch preview used to catch, e.g. a `404.html` disabling the SPA fallback) now
first shows on `main`: after a build-related change, run smoke against production before calling it done.
