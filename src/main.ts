// Two builds share this entry (docs/ORIGIN-MOVE.md phase 4). The GitHub Pages build sets VITE_MOVED_TO to the new address
// and mounts one "moved" screen; every other build is the app. The variable is replaced at build time, so each build
// contains only its own branch — the moved build has no router, no sync and no capture code at all.
if (import.meta.env.VITE_MOVED_TO) void import('./moved/main')
else void import('./mainApp')
