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
| 4 | Sign in with Google | Signed out, tap the ring, Continue with Google | Returns to the app signed in, the URL fragment is gone | not run per provider; **2026-10-11 Android: a sign-in reached production (session 01:47:58Z), provider not recorded** |
| 5 | Sign in with GitHub | Same, GitHub | Same | see row 4 |
| 6 | Capture → server | Capture a note with the connection on | Home status clears within ~10 s; Settings → Sync says up to date, 0 not on the server yet; the note is in the Dashboard list | **2026-10-11:** desktop Chrome in iPhone emulation (3 notes), then Android devices per the owner (3 more notes at 01:48:16Z; server versions 1–6) |
| 7 | Offline capture | Airplane mode, capture two notes, close and reopen the app, then switch the connection back on | Status says "2 not synced yet · offline" across the reopen; within ~a minute of reconnecting both are on the server | not run |
| 8 | Second device | Open the app on another device signed in to the same account | The first device's notes appear in the Dashboard list | not run in production |
| 9 | Signed-out with notes waiting | (Local only: delete the session row.) Capture, wait | Banner "Signed out of the server… kept on this device"; Sign out in Settings is refused with the count; after signing in again the notes upload | local dev only, 2026-10-11 |
| 10 | Update flow | Deploy a new build, open the installed app twice | The app reloads itself onto the new commit (the update banner never shows — the service worker updates automatically); a half-typed note is still in the box (check 13); no note is lost | not run |
| 11 | Install and offline reload | Install to the home screen, go offline, reopen | The app opens and shows the notes | not run |
| 12 | Export and delete | Settings → Your data → Export (any account); Delete **only on a throwaway account** | A file downloads with the notes; delete asks for the typed email and leaves the device cleared | export/delete verified on production with a throwaway account, API level only, 2026-10-11 |
| 13 | Unsent note survives | Type two lines on Home without tapping Capture; switch to another app for a minute, then swipe the app away and reopen it | The two lines are in the box; Capture sends them once; the box is empty afterwards (D-56) | not run on a phone |
| 14 | One capture per tap | Tap the Capture key twice quickly | One note in the Dashboard list | not run |
| 15 | Two windows | With the installed app AND a Chrome tab open on the same account: type in one, capture in the other, then sign out in one | The other box shows what was typed; a capture empties the other box; sign-out sends the other window to the sign-in screen; Settings → Sync stays "Up to date" in both (D-56, D-59) | not run |
| 16 | A refused sign-in | Sign in with a GitHub or Google account that has no invite | The sign-in screen says "Not invited" and names the address the provider reported; you are never left on a text page (D-57) | not run |
| 17 | Clear this device | (Needs an account deleted from another device, or a throwaway account.) Banner → Clear this device | The question counts the notes; a file downloads and opens from Files; then the device is cleared (D-55) | not run |
| 18 | Evening pass | In the evening, with two of today's notes open and one carried from an earlier day: open the pass, tap done on one, carry one to tomorrow, drop one | All three listed before the taps; after them none is open today; tomorrow's journal shows the carried one only; the dropped one never returns (D-65, D-67) | superseded by 23 (Dashboard v2: Daily lists Tasks, not notes) |
| 19 | Untapped note resurfaces | Leave one of today's notes open with no tap; open the pass the next evening | That note is listed in the next evening's pass (D-65) | superseded by 23 |
| 20 | Lead-time question | Capture a note with a due date three days ahead in its text; run the harness | The preview shows a follow-up to the due date and one question asking which earlier day; answering moves `followUpOn` to that day (D-66) | not run; on v2 the date and the question land on the Task |
| 21 | First v2 run | Capture two notes about one topic and one about another; Get feedback → copy, paste the reply, Check, Store | Check lists what Store writes; after Store the strip shows the questions under their Task, and Daily lists the Tasks due today; the change count is 0 | not run |
| 22 | A reply corrects scope | Answer a question with "these are two things"; Get feedback again | The Task is re-read (counted as a changed task); a split proposal appears in the strip; Yes leaves two Tasks and the original gone from Daily | not run |
| 23 | Daily taps | Tap ✓ on one Task, → on one, ✕ on one; then Undo | Each leaves Daily; Undo brings the last back; the → one is on tomorrow's Daily | local dev, synthetic data, 2026-10-12 |
| 24 | Edit summary | Edit summary: change a line, add a line, delete a line → Preview → Save | The preview names each change; the deleted line's Task is on tomorrow and a "Drop it, or keep it for later?" question is in the strip; Drop it drops it | local dev, synthetic data, 2026-10-12 |
| 25 | A prompt copied before the update | Copy a prompt on the old Dashboard, let the app update, paste the reply | Refused: "for a prompt from the previous version… Copy a new prompt"; nothing stored | not run |
| 26 | A Task reaches the server | After 21, open the app on a second device (or read D1) | The Tasks and questions are there (first prod write of the `task` kind; smoke cannot check it) | not run |

An iPhone round trip of the sign-in (H1-ENTRIES Q2) is separate and deferred until an invitee uses one.
