# H5-S1 step 0 — Spike

**Status: open, 2026-10-12.** Step 0 of H5 S1 ([H5-MODELS.md](H5-MODELS.md) §9). The spike runs on its own Worker
(`planner-spike-ai`) and its own D1 (`planner-spike`), so production is never touched; both are deleted when the spike
closes. Code: [`api/spike-ai/index.ts`](../api/spike-ai/index.ts).

## 1. What the spike must answer

| # | Question | Pass | Settles |
|---|---|---|---|
| A | When the client hangs up, does a long model call still finish and land in D1? | a 60 s job started by a client that disconnects after 2 s ends `ok` in D1 under at least one way of running it | D-83, H5-MODELS §10 O4 |
| B | Do both request formats work from the deployed Worker? | one call each in `anthropic-messages` and `openai-chat` returns text, a stop reason and token counts | D-81 |
| C | Is a cut-off reply recognised before parsing? | a call capped at 64 tokens comes back `cut_off` with no text kept | D-85 |
| D | How long does a harness-sized call take, and what does it cost in Worker CPU? | wall time per model on a 60-note synthetic prompt; Worker CPU p50/p99 per call | whether A matters for on-demand runs; the 10 ms CPU contract |
| E | Does a cron tick get the wall time an S3 routine needs? | an armed 60 s job run from the cron trigger ends `ok` | H5 S3 |

## 2. Method

Every job runs identically under three **modes**: `plain` (the handler awaits the job — the negative control),
`wu` (the same, also passed to `ctx.waitUntil`) and `wf` (a Workflow instance runs the job in one step; the handler
returns at once). A job is either a **timer** (free, deterministic) or a **provider call** (fixed synthetic prompts,
capped at 20 calls for the Worker's lifetime). Each job writes a heartbeat to D1 every 5 s, so when the runtime cancels
a job, `last_beat` says when. The client disconnects with `curl --max-time 2`.

What the docs predict (read 2026-10-12): HTTP requests have no wall-clock limit while the client is connected;
`waitUntil` extends execution for up to 30 s after the response is sent or the client disconnects; a Workflow step has
no wall-clock limit (10 ms CPU per step, free plan); a cron invocation may run 15 min; 5 cron triggers per account.

## 3. Owner setup — needed for B, C, D only (A and E need nothing)

**Never paste a key into chat.** Keys go only into a file you create yourself, then into the spike Worker's secrets.

1. **An Anthropic API key**: Claude Console → API keys → create one named `planner-spike`. Setting a small spend limit
   on its workspace is a good idea. Expected spend for the whole spike on `claude-opus-5-5` (the default, changeable):
   under $1.
2. **An OpenAI-compatible key**, to test the second format. Recommended: a Google AI Studio (Gemini) key, which has a free
   tier, so this costs $0. Gemini's free tier may use prompts to improve Google's products; the spike sends only
   synthetic text, but S2's preset for it must say so. An OpenAI or OpenRouter key works the same way.
3. Create `api/spike-ai/.env.spike` yourself (git-ignored by `.env.*`; Claude never opens it) with:
   ```
   ANTHROPIC_KEY=...
   OAI_KEY=...
   ```
4. Upload, then delete the file:
   ```bash
   pnpm --dir api exec wrangler secret bulk spike-ai/.env.spike -c spike-ai/wrangler.toml
   ```
5. Tell Claude which provider the second key belongs to (not a secret). Claude sets its base URL and model id.

## 4. Results

**A — answered 2026-10-12 (timers; a real provider call under `wf` and `wu` repeats it once keys are set).** From D1
on the deployed spike; the client disconnected at 2 s in every row but the first.

| Mode | Job | Client | Outcome | Last heartbeat | Ended |
|---|---|---|---|---|---|
| `plain` | 10 s | stays connected (positive control) | `ok` | +5.0 s | +10.0 s |
| `plain` | 60 s | drops at 2 s (negative control) | **cancelled** — stuck `running` | none after the start | — |
| `wu` | 20 s | drops at 2 s | `ok` | +15.1 s | +20.0 s |
| `wu` | 60 s | drops at 2 s | **cancelled** — stuck `running` | +30.2 s | — |
| `wf` | 60 s | handler answers 202 at once | `ok` | +59.4 s | +64.0 s (≈4 s queue start) |
| `wf` | 300 s | handler answers 202 at once | `ok` | +298.4 s | +301.2 s |

The docs held: a plain await dies with the client; `waitUntil` buys about 30 s after the disconnect (killed between
+30.2 s and the next beat at +35 s); a Workflow step is not tied to the client at all, and ran 5 minutes.

**E — answered 2026-10-12.** An armed 60 s job ran from the cron trigger: `ok`, ended +60.1 s. The `*/10` tick due at
22:50:00 UTC started at 22:51:19 — a cron tick can start more than a minute late, so a routine's time is "around",
not exact.

**A, repeated with a real call — 2026-10-12.** A harness-sized call to `gemini-3.1-flash-lite` run as a Workflow ended
`ok` in D1 (+9.9 s). Under `wu`, a call the client left at 2 s still wrote its row at +3.7 s (a 503), so an in-flight
`fetch` outlives the disconnect the same way a timer does.

**B — `openai-chat` ✅ (Gemini, 2026-10-12); `anthropic-messages` not run (no key yet).** Base
`https://generativelanguage.googleapis.com/v1beta/openai`, field `max_tokens` accepted. Small call per model:

| Model | Result |
|---|---|
| `gemini-3.5-flash` | `ok`, stop `stop`, 15 in / 5 out tokens, 1.4 s |
| `gemini-3.1-flash-lite` | `ok`, 4.7 s |
| `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-flash-latest` | **503 `UNAVAILABLE` in under 0.6 s**, every time |
| `gemini-2.5-flash` | **404 `NOT_FOUND`**, though `/models` lists it |

So the key's model list is not the list of models it can call, and an instant 503 means "this model is not available to
this key", not "the provider is down".

**C — `openai-chat` ✅.** The 64-token call returned `finish_reason: "length"` → `cut_off`, no text kept.

**D — 2026-10-12.**
- *Duration of a harness-sized call* (60 synthetic notes, ~1,750 tokens in): `gemini-3.5-flash` **57.6 s** (1,517 tokens
  out, reply in a ```json fence); `gemini-3.1-flash-lite` **9.9 s** (880 out, bare JSON). Real calls run past the ~30 s
  `waitUntil` window.
- *Free-tier reliability:* `gemini-3.5-flash` harness calls succeeded **1 of 7**; the other six returned 503 after 4–31 s
  of generation. `gemini-3.1-flash-lite`: 1 of 1.
- *Worker CPU per call* (`wrangler tail`, n=14, `api/scripts/cpu-summary.mjs`): **p50 6 ms, p99 17 ms**. Both calls over
  10 ms (16, 17 ms) were a cold start and the one successful 57 s call, whose CPU includes the spike's heartbeat (a D1
  write every 5 s), which production does not have. A Workflow step also has a 10 ms CPU limit on the free plan, so S1
  measures its real step.

Provider calls used: 16 of 20.

## 5. Decision

*At close.*
