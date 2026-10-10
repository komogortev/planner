# Runbook — run, test, deploy

Commands run from `E:/Projects/apps/personal-planner`. There is no staging environment: **local** and **production**.

## Local

| What | How | Link |
|---|---|---|
| App (dev, hot reload) | launch config `personal-planner` | http://localhost:5176/planner/ |
| Sign-in test screen | Settings → Account (preview) → Sign-in test | http://localhost:5176/planner/spike-auth |
| API (Worker, local D1) | launch config `planner-api` | http://localhost:8787/health |
| App as built for production | `pnpm build`, then launch config `personal-planner-preview` | http://localhost:4173/planner/ |

| Check | Command | What it covers |
|---|---|---|
| Everything offline | `pnpm check` | typecheck (app + api) · app unit tests · Worker tests in workerd with a fresh D1 per test |
| App tests only (watch) | `pnpm test` | `src/**` |
| Worker tests only | `pnpm test:api` | `api/test/**` |
| Smoke the running local stack | `pnpm smoke:local` | both launch configs running; same 11 checks as production |

Local sign-in needs an invite in the **local** D1 (the `.wrangler/` state):
`node api/scripts/invite.mjs create <email>` · `list` · `revoke <email>`.

## Production

| What | Link |
|---|---|
| App | https://komogortev.github.io/planner/ |
| Sign-in test screen | https://komogortev.github.io/planner/spike-auth |
| API health | https://planner-api.komogortev.workers.dev/health |
| App deploys (GitHub Actions → Pages) | https://github.com/komogortev/planner/actions |
| Worker, logs, D1 | https://dash.cloudflare.com → Workers & Pages → `planner-api`; D1 → `planner` |

| Check | Command |
|---|---|
| Smoke production (read-only, 11 checks incl. refusals) | `pnpm smoke` |
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
3. `pnpm smoke`

Between steps 1 and 2 the new app runs against the old Worker for a minute or two. That is fine while every Worker
change is backwards compatible with the app before it — keep it so (add, don't rename; the app tolerates a missing
field). Roll back the Worker: `pnpm --dir api exec wrangler rollback`. D1 migrations have no down step; the undo is
D1 Time Travel (point-in-time restore of the whole database), so migrations only add.

Secrets: production via `pnpm --dir api exec wrangler secret bulk <file>` (then delete the file); local in `api/.env`,
which only the owner edits.
