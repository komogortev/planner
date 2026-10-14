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

The app has the same one-way door on each device: once a device opens a build with a newer Dexie version, an older build
cannot open its database (Dexie refuses a lower version). Never roll Pages back past a Dexie version bump; fix forward.
Last bump: v7 (financial tables dropped, D-112).

Secrets: production via `pnpm --dir api exec wrangler secret bulk <file>` (then delete the file); local in `api/.env`,
which only the owner edits.

**`MODEL_KEY_SECRET` (H5, encrypts users' model API keys — [H5-MODELS.md](H5-MODELS.md) §6).** 32 random bytes, base64.
Without it, saving a model key and every model call answer 503 `not configured`; nothing else breaks. Create it so the
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

## After a D1 restore (Time Travel) or a hand edit of the version counter

The clients notice (D-58): a pull whose `head` is below the device's cursor — or a push given a version at or below it — starts a sweep from 0, and the notes the server lost are uploaded again from the devices that still hold them. A restore needs nothing else from you. Two things do not heal on their own: if you edit `users.version_seq` by hand, set it to **at least `max(server_version)` of that account** (below it, every device sweeps again on every poll); and edits or deletes that were acknowledged inside the lost window are not reconciled (notes are create-only today; re-entry: before an edit or delete UI ships).

## Error log (S4, D-24)

The app reports `js-error`, `promise-rejected` and `sync-stuck` (a sync failing three times in a row) to `POST /log`:
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
