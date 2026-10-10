# H1-S1 — Spike kickoff

**Status: ready, 2026-10-09.** Step 0 of H1 ([H1-ENTRIES.md](H1-ENTRIES.md) §13). Budget: **1–2 sessions**, +1 per
fallback taken. Cost: $0 — no billing account is needed anywhere in this spike.

## 1. What the spike must answer

| # | Question | Pass | Settles |
|---|---|---|---|
| A | Does a Worker + D1 on the **free plan** serve our requests? | read + write round trip from the deployed Pages origin, CORS clean | B2 holds |
| B | Does sign-in fit the free plan's **10 ms CPU per request**? | p99 CPU ≤ 7 ms (30 % headroom) on `/auth/callback/*`, `/me`, a D1 write | H1 §12 Q1 |
| C | Does **iPhone home-screen** sign-in come back into the installed app? | sign-in completes, the installed app shows "signed in", and survives being closed and reopened | H1 §12 Q2 |

Nothing else is in scope. No entries table, no sync, no UI beyond a test screen.

## 2. Owner setup — before the session (~45 min)

Only the owner can do these: they create accounts and handle secrets. **Never paste a secret into chat**; it goes
straight into the Worker's secret store or the git-ignored `api/.dev.vars`.

**Cloudflare**

1. Create a Cloudflare account (free plan). Choose the `workers.dev` subdomain when asked — it becomes part of the API
   URL: `https://planner-api.<subdomain>.workers.dev`. Tell Claude the subdomain (it is not a secret).
2. In the repo, after Claude scaffolds `api/`: run `pnpm --dir api exec wrangler login` and approve in the browser.

**GitHub sign-in — two OAuth Apps** (a GitHub OAuth App allows one callback URL, so dev and prod are separate)

| App | Homepage URL | Authorization callback URL |
|---|---|---|
| `planner-dev` | `http://localhost:5173` | `http://localhost:8787/auth/callback/github` |
| `planner` | `https://komogortev.github.io/planner/` | `https://planner-api.<subdomain>.workers.dev/auth/callback/github` |

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Keep each Client ID; generate a Client secret for
each.

**Google sign-in — one OAuth client**

1. Google Cloud Console → new project `planner` → Google Auth Platform: **External**, publishing status **Testing**.
   Add yourself as a **test user**. Testing mode admits only listed test users, which matches invite-only; the scopes
   used (`openid email profile`) need no verification.
2. Clients → Create client → **Web application**. Authorized redirect URIs:
   `http://localhost:8787/auth/callback/google` and `https://planner-api.<subdomain>.workers.dev/auth/callback/google`.
   Keep the Client ID and secret.

**Where the secrets go**

| Value | Local dev | Production |
|---|---|---|
| GitHub client id/secret (`planner-dev`) | `api/.dev.vars` | — |
| GitHub client id/secret (`planner`) | — | `wrangler secret put GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` |
| Google client id/secret | `api/.dev.vars` | `wrangler secret put GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| Session signing secret | `api/.dev.vars` (any random string) | `wrangler secret put SESSION_SECRET` |

`.dev.vars` and `.wrangler/` are git-ignored (added with this doc). Claude checks `git status` shows neither before
every commit.

## 3. Session plan

| Step | Work | Evidence written to §6 |
|---|---|---|
| 0 | `dependency-audit` on the candidates: auth (Better Auth vs Arctic + own `sessions` table) and router (Hono vs plain `fetch` handler). Pick the smallest that does the job | the picks, bundle sizes |
| 1 | Scaffold `api/` (own `package.json`, `wrangler.toml`), `wrangler d1 create planner`, one table, `GET /health` + `POST /spike/note` writing and reading a row | local round trip |
| 2 | Deploy the Worker; CORS allows exactly `https://komogortev.github.io` and `http://localhost:5173` | request from the Pages origin succeeds; one from another origin is refused (negative control) |
| 3 | GitHub + Google sign-in → bearer session token → `GET /me` | signed in locally with both providers |
| 4 | **Known positive for the CPU check:** a throwaway `/spike/burn` route that loops ~20 ms of CPU. It must show > 10 ms in the measurement, or fail with error 1102 (exceeded resource limits). Only then trust the next step's numbers | the burn route's reading |
| 5 | Measure CPU: 20 calls each to the callback, `/me`, `/spike/note`. Read p50/p99 from the dashboard (Workers → Metrics → CPU time) or `wrangler tail --format json`, whichever this account shows | table in §6 |
| 6 | Hidden test screen in the app: route `/spike-auth`, reachable only from a link in Settings → "Sign-in test". Merged to `main` so the installed PWA has it | deployed |
| 7 | **iPhone protocol (owner, ~15 min):** delete any old home-screen icon → open the site in Safari → Share → Add to Home Screen → open from the icon → Settings → Sign-in test → sign in with GitHub, then Google. Record: did it return to the installed app? Signed in? Close the app fully, reopen: still signed in? Open the same page in a Safari tab: signed **out** (separate storage — expected) | outcome per provider |
| 8 | Close: record results, decide by §4, update H1 §12 Q1–Q2, delete `/spike/burn` and `/spike/note` | H1 doc + STATE |

## 4. Decision rules

| Result | Then |
|---|---|
| A, B, C all pass | S2 starts on the picks; the `api/` skeleton is kept as S2's base |
| B fails with the picked library | Switch to the other auth candidate, re-measure (+1 session) |
| B fails with both | Stop; evaluate Dexie Cloud (H1 §11 fallback) with the owner before any S2 work |
| C fails (sign-in strands in Safari) | Build the **handoff by polling**: the app creates a sign-in request id, opens the provider page, polls `GET /auth/handoff/<id>` until the Worker holds the result (+1 session). Retest step 7 |
| C fails with the handoff too | Stop; options for the owner: email one-time code (needs an email service) or Dexie Cloud's built-in email code |
| A fails | Stop; it contradicts the free-tier facts in H1 §11 — re-check limits before anything else |

A stop is reported with the evidence; nothing switches backend without the owner.

## 5. Not in the spike

Entries, outbox, sync, cleaning, invites, rate limits, migrations, the capture page (all S2–S3). The test screen and
spike routes are removed by S3.

## 6. Results

*Filled in during the spike.*

| Item | Result |
|---|---|
| Auth / router picks | |
| Burn route (known positive) | |
| CPU p50 / p99 — callback · `/me` · D1 write | |
| CORS negative control | |
| iPhone — GitHub · Google · after reopen · Safari tab separate | |
| Decision | |
