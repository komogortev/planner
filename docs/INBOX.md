# INBOX

Filled by the notes intake (skill `notes-intake`); the owner closes lines. Counted at session start.

- [ ] d8b55d63 · 2026-11-08 · chore · Separate wrangler auth for the planner and Cardloft: a scoped CLOUDFLARE_API_TOKEN per repo plus account_id in each wrangler.toml, so logging in for one never breaks the other (today one global login sees only Cardloft `b6d2…`; the planner is `9d0abf…`, so task-add and deploys fail with 7403/7404) · state: open (blocks the D-141 prod dry run) · src: owner, chat 2026-11-08
- [ ] 0285251f · 2026-10-22 · chore · Create a GitHub token so the planner can connect the Cardloft card (see: cardloft) · state: open · src: task
- [ ] 954c93b1 · 2026-10-15 · chore · Phone-test the feedback strip end to end · state: open (DEVICE-CHECKS, R9) · src: task
- [x] 370aace1 · 2026-10-14 · feature · Drop the "Copy instead" button · state: built (#174, copy-paste retired; no such label left in src) · src: task · closed: 2026-10-25 done in the live account (task-state.mjs dry run, account head 226)
- [x] e7a84205 · 2026-10-14 · feature · Add-task input grows with long text · state: built (#175, `growAdd` in DailyCard.vue) · src: task · closed: 2026-10-25 done in the live account (task-state.mjs dry run, account head 226)
- [x] 80a3acb0 · 2026-10-14 · feature · Get feedback opens the first question with its input ready; a strip tap does not commit · state: built (#175, G8) · src: task · closed: 2026-10-25 done in the live account (task-state.mjs dry run, account head 226)
- [x] ea47acc1 · 2026-10-14 · feature · Empty queue: Get feedback opens a free box for a question or correction · state: built (#175, G9) · src: task · closed: 2026-10-25 done in the live account (task-state.mjs dry run, account head 226)
- [ ] c176f30c · 2026-10-14 · feature · Strip expands with a run-through button to force reassessment · state: built (#175, `runThrough`; phone check pending, left open by owner 10-25) · src: task
- [x] 5b072959 · 2026-10-14 · decision · Widgets page should feel like construction/template, unlike the dashboard · state: built (#191, dashed template slots) · src: task · closed: 2026-10-25 live on prod (koplanner.pages.dev serves the new CSS)
