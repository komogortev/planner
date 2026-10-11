# Moving the app off `komogortev.github.io` (design)

**Status 2026-10-11: phases 0 and 1 done (`https://koplanner.pages.dev/`, name changed from the default by the owner; PRs #57–#59, Worker deployed). Phase 2 ✅ the same day (both providers signed in on the new origin, existing notes appeared). Phase 3 ✅ (phone + desktop). Phase 4 ✅ the same day (#62). Next: phase 5 — only when the owner has seen the notice on every old install; until then the old origin stays in `ALLOWED_APP_URLS`. Phase 1 note: the build must emit no `404.html` on Cloudflare (it disables the SPA fallback), so `_redirects` was dropped.** S0 closed the same day — the owner took every recommended default in §6. Part of H1 S4 (owner: "its own session, before the
exit week"). Terms per [VOCABULARY.md](VOCABULARY.md); the amendment this carries out is H1-ENTRIES Q8 ("the client
moves to its own free `*.pages.dev` origin at S4").

## 1. Why — and how much it matters

The app lives at `https://komogortev.github.io/planner/`. An origin is host + scheme + port, not a path, so the planner
shares one browser origin with **every GitHub Pages site under the same account**
(`api/src/config.ts` says so; the list of sibling sites is **not verified** — check `Settings → Pages` per repo).

| What is origin-scoped | Consequence on a shared origin |
|---|---|
| `localStorage` (the session token is here) | any sibling page's script can read it |
| IndexedDB (every note on the device) | same |
| Service worker scope | separate by path, but a sibling can register one that shadows nothing — low risk, listed for completeness |
| HTTP response headers | **GitHub Pages cannot set any**: no Content-Security-Policy, no `frame-ancestors`, no `Referrer-Policy` |

The last row is a finding: ARCHITECTURE §7 says "the CSP limits `connect-src` to the Worker and `api.github.com`". I
grepped `index.html` and `public/`: **no CSP is shipped today**, and on GitHub Pages it could only be a `<meta>` tag
(no `frame-ancestors`, no report-only). So the move buys two real things: the token and the notes stop sharing an
origin, and the app can finally ship the headers its architecture doc already claims.

Honest size of the risk today: exploiting it needs a script running on a sibling Pages site of the owner's. It is a
hardening move, not a fire. Its cost is that **an origin change does not carry local data or the token** (§5).

## 2. Options

| | A. Cloudflare Pages, own `*.pages.dev` (**Recommended**) | B. Serve the client from the Worker (static assets) | C. Custom domain | D. Stay |
|---|---|---|---|---|
| New origin | `<name>.pages.dev` | `planner-api….workers.dev` — same origin as the API | `planner.<owner domain>` | none |
| Response headers (CSP etc.) | yes, `_headers` file | yes | yes | no |
| API calls | cross-origin (CORS as today, bearer token) | same-origin — no CORS, cookies become possible | cross-origin | cross-origin |
| Deploy chain | Cloudflare builds `main` (Git integration) or an Actions job with a token | one `wrangler deploy` ships both; from the owner's machine, guarded, as the Worker is today | as A | GitHub Actions (today) |
| Money | $0 (free plan; verify limits when building) | $0 | a domain costs money — H1 Q8 said no | $0 |
| What changes in the code | build base `/`; `_headers`; `_redirects` (SPA fallback); Worker allow-list; env cue | all of A's client changes + serving assets from the Worker + a deploy-order rule so app and API cannot drift | A + DNS | nothing |
| Main downside | a second hosting product and one owner authorisation (Cloudflare ↔ GitHub) | app and API deploy together, so a bad Worker deploy takes the app down too; cookies are a bigger redesign than this slice | cost, DNS | the risk in §1 stays |

Why A: it is the smallest change that fixes both findings, keeps the bearer-token design (H1 Q8) and the existing
CORS list, and leaves the Worker alone except for one additive config line. B is worth revisiting when the tokens move
to cookies; that is a separate decision, not part of this slice.

`planner.pages.dev` is **already taken** (answers 200 today). `komogortev-planner.pages.dev` and two other names I tried
did not resolve, so they look free; a name is only certain once the project is created.

## 3. What touches what (inventory from the repo)

| Place | Today | Change |
|---|---|---|
| `vite.config.ts` | `base: '/planner/'` (baked in, 2026-04-24) | base from an env var: `/` for the new origin; the old `/planner/` only for the "moved" build (§4, phase 4) |
| PWA manifest | `start_url: '.'`, `scope: './'` | unchanged — relative, follows the base |
| `src/router/index.ts`, `src/auth/signIn.ts`, `src/log/report.ts` | use `import.meta.env.BASE_URL` | unchanged — already base-relative |
| `api/wrangler.toml` `ALLOWED_APP_URLS` | `https://komogortev.github.io/planner/` | comma list: add the new origin **second**; the favicon route fetches `icon.svg` from the **first** entry, so swap the order only at cut-over |
| `api/src/auth.ts` return_to check, CORS | prefix check against the list, origins derived from it | unchanged — both read the list. **One limit (D-57):** a sign-in whose flow cookie is lost has no `returnTo` to go back to, so its `#error=expired` refusal goes to the FIRST entry of the list; in phase 2, while the old origin is still first, a person who started on the new origin lands on the old one, which has no pending sign-in and shows nothing. Rare, and better than the text page it replaced; swap the order at cut-over as planned |
| OAuth providers (GitHub, Google) | redirect to the Worker's `/auth/callback/<provider>` | **unchanged**: the callback is the Worker's, not the app's (read from `redirectUri` in `auth.ts`). Verify once in each provider's console that no app origin is registered |
| `src/env/appEnv.ts` | `*.github.io` = prod; says "S4 adds the hosted staging host here" | add: a `*.pages.dev` host that is not the production hostname = `preview` (Cloudflare makes a URL per branch; they cannot sign in — the Worker refuses their origin) |
| `api/scripts/smoke.mjs`, `docs/RUNBOOK.md`, `appEnv.test.ts` | hardcode the old URL / list `planner.pages.dev` as a prod example | read the app URL from one setting; update links and the test example |
| `.github/workflows/deploy.yml` | builds and publishes the app to GitHub Pages | after phase 4 it publishes only the "moved" build |
| New: `public/_headers`, `public/_redirects` | — | CSP (`default-src 'self'`; `connect-src 'self' <Worker>`; `img-src 'self' data:`; `frame-ancestors 'none'`), `Referrer-Policy`, `X-Content-Type-Options`; SPA fallback `/* /index.html 200` |

## 4. Order of work (every step reversible until phase 4)

| Phase | Who | What | Done when |
|---|---|---|---|
| 0 | **owner** | pick the name (§6 Q2); create the Cloudflare Pages project connected to the repo (authorising Cloudflare's GitHub app is the owner's click) with production branch `main` and `pnpm build` | project exists, first build runs |
| 1 | Claude, PR | env-driven base; `_headers`, `_redirects`; `appEnv` rule; smoke + RUNBOOK read one URL; Worker allow-list gains the new origin (additive) → guarded Worker deploy | tests green; Worker accepts the new origin; old origin untouched |
| 2 | Claude + owner | smoke against the new origin; a real provider sign-in there (**both** providers: DEVICE-CHECKS 4–5); the existing notes appear by a first pull (the new-device path, D-29, on real data); CSP checked in the browser console with no violation | desktop and phone both sign in and list the notes on the new origin |
| 3 | owner, per device | the precondition **0 not on the server yet** (Settings → Sync) on the old copy; open the new URL, install it, sign in, confirm the notes; the tester does the same (they need a short written note with the new link) | every device is on the new origin |
| 4 | Claude, PR | the old origin becomes a **moved notice**: the same build in a `moved` mode that mounts one screen — "Planner moved to <url>", **Save a copy of this device's notes**, **Clear this device** (the account tables and the token, with the unsynced count named) — and starts no sync. The existing service worker updates itself to it | the old URL shows the notice on a device that had the app installed |
| 5 | Claude, later | drop the old origin from `ALLOWED_APP_URLS` (sign-in and CORS now refuse it) | owner says no device still uses the old copy |

Rollback: phases 0–3 only add; remove the new origin from the list and delete the Pages project. Phase 4 is the first
step that changes what the old URL serves; do it only after phase 3 is confirmed for every device. If it is done too
early, rolling back means redeploying an older commit through `deploy.yml`.

## 5. Risks

| Risk | What the owner would see | Mitigation |
|---|---|---|
| A device moved with notes still unsynced | the notes stay on the old origin's database, invisible from the new one | phase 3 precondition (0 not on the server yet); phase 4's "Save a copy" is the last resort |
| Both origins live at once | none: the server orders changes (A12) and both sign in to the same account | intended: it is what makes the move gradual |
| Old installed copy keeps the old shell | the old app keeps working until phase 4 | by design; phase 4's service-worker update is the switch |
| The tester loses track | they open the old link and see the notice | the notice; plus a one-line message from the owner at phase 3 |
| CSP too strict | a blank screen or a failed sign-in on the new origin | checked in phase 2 before any device moves; the header is a file, so it is fixed by a redeploy, not a migration |
| Cloudflare build differs from CI | a build that passes CI but fails there, or a wrong commit shown in the badge | smoke's "deployed app is origin/main" check runs against the new origin too |
| `planner.pages.dev`-style name collisions | project creation refuses the name | pick another; nothing else depends on it |

## 6. Questions for the owner — answered 2026-10-11: all recommended (Q1 A · Q2 `komogortev-planner` · Q3 Git integration · Q4 CSP enforced · Q5 moved notice · Q6 before the exit week). Q7 not answered; not needed to proceed. Name availability is only certain once the project is created: if it is refused, the owner picks another and nothing else changes.

| # | Question | Default |
|---|---|---|
| Q1 | Where to host | **A. Cloudflare Pages (Recommended)** |
| Q2 | Name (global, public in the URL) | **`komogortev-planner` (Recommended)** — your handle is already in the repo and Pages URL; a neutral name is also fine |
| Q3 | How it deploys | **Cloudflare's Git integration (Recommended)** — builds `main` on push, no token in GitHub; the alternative is an Actions job with a Cloudflare API token you create as a repo secret |
| Q4 | Headers | **ship the CSP and the other headers in the same slice, enforced (Recommended)**, checked in phase 2 |
| Q5 | The old URL afterwards | **the moved notice with Save a copy / Clear this device (Recommended)** over a bare redirect (a redirect cannot rescue unsynced notes) |
| Q6 | When | **before the exit week; phase 3 on a day with no unsynced notes anywhere (Recommended)** |
| Q7 | Sibling Pages sites | list the repos under your account that publish a Pages site, so §1 can state the real exposure (not needed to proceed) |

## 7. Verification (known positives first)

| Check | Must fail when |
|---|---|
| Worker accepts `return_to` on the new origin and still refuses an unlisted one | the allow-list prefix check were loosened |
| A build with the new base serves deep links (`/dashboard`, `/settings`) through `_redirects` | the fallback rule were missing |
| The CSP header is present on `/` and on a deep link, and the page loads with no violation | `_headers` were not published |
| `appEnv`: the production hostname = prod, a branch preview host = preview, `localhost.evil.com` ≠ local | the rule matched on a suffix only |
| The moved build starts no sync and offers the unsynced count before clearing | it mounted the normal app |
| `pnpm smoke` against both origins | either answers differently |
