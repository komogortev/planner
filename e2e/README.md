# Browser E2E (Playwright)

`pnpm e2e` starts three local processes, runs the specs in installed Chrome at 390×844, and stops them:

- `stubProvider.mjs` — a stand-in model provider (`:8792`) that builds its reply from the note ids in the request. `GET /requests` lists the calls it saw.
- `startApi.mjs` — wipes `e2e/.state/`, migrates a **local** D1, seeds one test account + session + a model pointing at the stub (`seed.mjs`; the API itself refuses a localhost base URL), then runs `wrangler dev` (`:8791`). Never `--remote`.
- the app's Vite dev server (`:5191`) with `VITE_API_URL` set to that Worker.

Ports and the dev-only values are in `ports.mjs` (override with `E2E_APP_PORT`, `E2E_API_PORT`, `E2E_STUB_PORT`). Tests sign in by planting the seeded session token in `localStorage`; no OAuth, no real key, no production.

Specs map to the tester script in `docs/ALPHA-TEST-PLAN.md` §1 (T5, T10). Every positive has a negative control (here: a reply that is not the harness JSON). CI is not wired yet: it needs `playwright install chromium` (the local config uses the installed Chrome).
