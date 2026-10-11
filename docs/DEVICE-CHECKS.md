# Device checks

What only a real phone can answer. Run the rows that match a PR (any change to the shell, capture, sync, sign-in or
install) on the owner's Android phone **in the installed app**, and write the date and commit next to anything that fails.
Desktop browser emulation of a phone does not count: it cannot judge touch, keyboards, or the browser's own gestures
(D-25, [DECISION-TREE.md](DECISION-TREE.md)).

Before you start: the badge at the bottom reads the commit you mean to test. If it does not, close and reopen the app
until it does (a new version loads on the second open), or tap Reload on the update banner.

| # | Check | Do | Pass when | Last result |
|---|---|---|---|---|
| 1 | Pager vs browser scroll | Swipe between pages with the finger; scroll the Dashboard list and Settings vertically | A sideways drag moves pages and follows the finger; a vertical drag scrolls the page, never both; no pull-to-refresh fires | not run on a phone |
| 2 | Feel: parallax, cloth pull, blur | Drag slowly and flick, at the first and last page | Smooth, no stutter; the backdrop moves less than the page; the folds spring back | not run on a phone |
| 3 | Keyboard over the dictophone | Tap the cassette window, type three lines | The keyboard does not hide the window or the key; Capture is reachable; the page does not zoom | not run on a phone |
| 4 | Sign in with Google | Signed out, tap the ring, Continue with Google | Returns to the app signed in, the URL fragment is gone | not run |
| 5 | Sign in with GitHub | Same, GitHub | Same | not run |
| 6 | Capture → server | Capture a note with the connection on | Home status clears within ~10 s; Settings → Sync says up to date, 0 not on the server yet; the note is in the Dashboard list | **2026-10-11 `ccca2cf`: desktop Chrome in iPhone emulation only** — real phone not run |
| 7 | Offline capture | Airplane mode, capture two notes, close and reopen the app, then switch the connection back on | Status says "2 not synced yet · offline" across the reopen; within ~a minute of reconnecting both are on the server | not run |
| 8 | Second device | Open the app on another device signed in to the same account | The first device's notes appear in the Dashboard list | not run in production |
| 9 | Signed-out with notes waiting | (Local only: delete the session row.) Capture, wait | Banner "Signed out of the server… kept on this device"; Sign out in Settings is refused with the count; after signing in again the notes upload | local dev only, 2026-10-11 |
| 10 | Update flow | Deploy a new build, open the installed app twice | Update banner appears; after Reload the badge shows the new commit; no note is lost | not run |
| 11 | Install and offline reload | Install to the home screen, go offline, reopen | The app opens and shows the notes | not run |
| 12 | Export and delete | Settings → Your data → Export (any account); Delete **only on a throwaway account** | A file downloads with the notes; delete asks for the typed email and leaves the device cleared | export/delete verified on production with a throwaway account, API level only, 2026-10-11 |

An iPhone round trip of the sign-in (H1-ENTRIES Q2) is separate and deferred until an invitee uses one.
