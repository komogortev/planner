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
straight into the Worker's secret store or the git-ignored `api/.env`.

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

*Corrected 2026-10-09 (session 1): `.env` instead of `.dev.vars`, `secret bulk` instead of `secret put`, no
`SESSION_SECRET`, plus `ALLOWED_EMAILS` — see §6 environment notes for why.*

| Value | Local dev — `api/.env`, created by the owner | Production — `api/.env.production`, uploaded then deleted |
|---|---|---|
| GitHub client id/secret | `planner-dev` app | `planner` app |
| Google client id/secret | same client | same client |
| `ALLOWED_EMAILS` (verified emails, comma-separated) | yes | yes |

Production upload: `pnpm --dir api exec wrangler secret bulk .env.production`, then delete the file.
`.env`, `.env.*`, `.dev.vars` and `.wrangler/` are git-ignored. Claude checks `git status` shows none of them before
every commit, and never creates or reads `api/.env*`.

## 3. Session plan

| Step | Work | Evidence written to §6 |
|---|---|---|
| 0 | `dependency-audit` on the candidates: auth (Better Auth vs Arctic + own `sessions` table) and router (Hono vs plain `fetch` handler). Pick the smallest that does the job | the picks, bundle sizes |
| 1 | Scaffold `api/` (own `package.json`, `wrangler.toml`), `wrangler d1 create planner`, one table, `GET /health` + `POST /spike/note` writing and reading a row | local round trip |
| 2 | Deploy the Worker; CORS allows exactly `https://komogortev.github.io` and the local app (`http://localhost:5176` since session 2) | request from the Pages origin succeeds; one from another origin is refused (negative control) |
| 3 | GitHub + Google sign-in → bearer session token → `GET /me` | signed in locally with both providers |
| 4 | **Known positive for the CPU check:** a throwaway `/spike/burn` route that loops ~20 ms of CPU. It must show > 10 ms in the measurement, or fail with error 1102 (exceeded resource limits). Only then trust the next step's numbers | the burn route's reading |
| 5 | Measure CPU: 20 calls each to the callback, `/me`, `/spike/note`. Read p50/p99 from the dashboard (Workers → Metrics → CPU time) or `wrangler tail --format json`, whichever this account shows | table in §6 |
| 6 | Hidden test screen in the app: route `/spike-auth`, reachable only from a link in Settings → "Sign-in test". Merged to `main` so the installed PWA has it | deployed |
| 7 | **iPhone protocol (owner, ~15 min):** delete any old home-screen icon → open the site in Safari → Share → Add to Home Screen → open from the icon → Settings → Sign-in test → sign in with GitHub, then Google. Record: did it return to the installed app (*Running as*)? Signed in? If not, what does *Last sign-in return* say? (Landing in a Safari context instead shows "rejected: no sign-in was started from this app" — that is the C-fail signal.) Close the app fully, reopen: still signed in? Open the same page in a Safari tab: signed **out** (separate storage — expected) | outcome per provider |
| 8 | Close: record results, decide by §4, update H1 §12 Q1–Q2. Remove: `/spike/landing` + the `spikeLanding` exception in `auth.ts`; a `0003` migration dropping `spike_notes` (`/spike/burn` + `/spike/note` already went in session 1). The `/spike-auth` test screen stays until S3 | H1 doc + STATE |

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

Entries, outbox, sync, cleaning, invites, rate limits, migrations, the capture page (all S2–S3). Spike routes go at
step 8; the test screen by S3.

**Carried to S2 from the session-1 review** (low risk while a token only reads `/me`; Blocking once it guards entries):

- ~~**Login CSRF on the last hop.**~~ Done in session 2 (step 6): the app keeps a nonce in `localStorage` (not
  `sessionStorage` — an iOS home-screen app may return in a new browsing context, which would fail C for the wrong
  reason), passes it through `/auth/start`, the Worker echoes it in the fragment; a mismatch, a missing pending
  sign-in or one older than 10 minutes is rejected.
- **Shared origin (session-2 review).** `komogortev.github.io` hosts every Pages site the owner has; localStorage
  and CORS are per origin, so any of those sites can read the bearer token and call the API with it. Fine while the
  token reads only `/me`; **before entries, the app needs its own origin** (custom domain or a dedicated Pages host) —
  an owner call.
- **Token in browser history / Worker logs (unverified).** The 302 lands on `/planner/#token=…`; global history
  (Safari/iCloud, Chrome Sync) may record it before `replaceState` runs, and Workers observability may log the
  `Location` header. Check both after the first prod sign-in; if either holds, return a short-lived single-use code in
  the fragment and exchange it by POST.
- **Google email linking.** `email_verified` on a non-Gmail Google account was checked once, at creation. Auto-link
  only `@gmail.com` or tokens with `hd`; otherwise the already-linked provider confirms.
- **Revoking an invite** must delete that user's sessions (the allowlist is checked only at sign-in); add logout and an
  expired-session purge.
- Two sign-ins in parallel tabs overwrite one flow cookie (name it per state if it matters). Check whether GitHub OAuth
  Apps take PKCE now, and enable it if so.

## 6. Results

Session 1, 2026-10-09 — steps 0–5. Steps 6–8 next session. Production figures from `wrangler tail`, summarised by
`api/scripts/cpu-summary.mjs`.

| Item | Result |
|---|---|
| Auth / router picks | **Own OAuth code** (fetch + Web Crypto, from the 0BSD examples Arctic's maintainer published) **+ Hono** 4.13 (8.1 KB gz). Arctic was the first pick (4.9 KB) but is **deprecated by its maintainer since 2026-07-29** — npm showed it only at install. Better Auth: 209.6 KB gz, 17 deps — stays the §4 fallback, though it is unlikely to be cheaper. Deployed Worker: 19.5 KB gz, 2 ms startup |
| Burn route (known positive) | meter reads true and scales: n=0 → 0 ms · 10 M → 27–34 ms · 25 M → 61–63 ms · 100 M → 240–246 ms. **No 1102 at any size** — over these 11 requests the free plan did not enforce 10 ms per request |
| CPU p50 / p99 — D1 write | 1 / 2 ms (n=20, paced) |
| CPU p50 / p99 — `/me` | 1 / 2 ms (n=10) |
| CPU p50 / p99 — callback | GitHub 5 / **9** ms (n=7: one 9, six at 5) · Google 3 / 6 ms (n=5) · start routes ≤ 1 ms (n=17). 12 callbacks = 12 session rows, so tail missed none. Short of the planned 20 per route |
| CORS negative control | Pages origin: `/health`, JSON POST, `Authorization` request all succeed. `example.com`: all three blocked, and **0 rows written** (preflight refused). Local: `localhost:5173` allowed, `evil.example` + `localhost:5176` refused |
| Sign-in | GitHub + Google, local and production: both resolve to **one account** (verified-email link); only SHA-256 token hashes stored. Allowlist (`ALLOWED_EMAILS` secret) stands in for S2 invites |
| Test screen + nonce (session 2, step 6) | `/spike-auth`, linked only from Settings → Account (preview). Shows *Running as* (installed app vs browser tab), *Status* (from `/me`), *Last sign-in return* (accepted, or why rejected). Controls, local: Worker 400 on missing / short nonce and on `:5173`; 302 to GitHub with a valid one; a forged `#token=` link is rejected, not stored, fragment scrubbed. A mutation dropping the nonce comparison fails 2 of 6 unit tests. **Positive end to end not yet run** — GitHub's password page is the owner's; the first desktop sign-in after deploy is it |
| Step 8 code (session 2) | `/spike/landing` + its `return_to` exception removed; `0003` drops `spike_notes` (applied locally) |
| iPhone — GitHub · Google · after reopen · Safari tab separate | *owner, after deploy* |
| Decision | **A ✅. B ✅ on steady state** (owner, 2026-10-09): every route p50 1–5 ms; the one 9 ms GitHub callback is an open outlier, under the limit and against a limit not enforced at 246 ms. **Re-entry:** when S2's real auth flow is deployed, read production CPU over ≥ 50 callbacks; p99 > 7 ms → find what in the route costs it before S2 continues. §4's "switch to the other candidate" does not apply to this kind of result (Better Auth cannot be cheaper). **C:** next session, steps 6–7 |

**Environment notes found on the way**

- Wrangler 4.149 needs Node ≥ 22; the machine moved 20.15 → **24.20** (Node 20 was EOL 2026-04-30). Typecheck + build
  green on SHARED, engine-dev, planner before and after.
- Local secrets live in **`api/.env`**, not `.dev.vars`: a file Claude wrote is echoed back to it on every save.
  Production secrets go in via `wrangler secret bulk <file>` — the interactive `secret put` prompt stored a 3-char value
  twice on this machine. `SESSION_SECRET` is not used (tokens are random, stored hashed; nothing is signed).
- The `personal-planner` launch config serves the app on **:5176**, which CORS refused. Session 2 picked **:5176**
  (`:5173` is three-dreams' pinned port in the workspace launch config); the local app URL is
  `http://localhost:5176/planner/`. The OAuth apps need no change — their callbacks are on `:8787`.
- `createWebHistory()` captures the URL when `router/index.ts` is evaluated, and imports are hoisted: a sign-in
  return handled in `main.ts`'s body was written back over by the router. It runs as the first import instead
  (`src/auth/consumeReturn.ts`).
- `wrangler tail` drops events in bursts — pace measurement calls.
- The planner's `typecheck` now also runs `api`'s (the Stop-hook gate mapped `api/*.ts` to `vue-tsc -b`, which never saw
  them). Known positive: a planted TS2322 in `api/` fails it.
