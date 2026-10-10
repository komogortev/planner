// Per-route CPU from a `wrangler tail --format json` capture (H1-S1 spike, step 5).
//   pnpm exec wrangler tail --format json > tail.jsonl     (keep the capture OUT of the repo: it holds IPs + headers)
//   node scripts/cpu-summary.mjs tail.jsonl <url substring> [rows|summary]
// Pace the calls: tail dropped 9 of 20 events from a burst; 20 of 20 at 1.5 s spacing. From Git Bash, drop the
// leading slash from the filter (MSYS rewrites "/x" into a Windows path).
import { readFileSync } from 'node:fs'
// wrangler tail --format json prints pretty-printed objects back to back; split on top-level braces.
const raw = readFileSync(process.argv[2], 'utf8')
const evs = []
let depth = 0, start = -1, inStr = false, esc = false
for (let i = 0; i < raw.length; i++) {
  const ch = raw[i]
  if (inStr) {
    if (esc) esc = false
    else if (ch === '\\') esc = true
    else if (ch === '"') inStr = false
    continue
  }
  if (ch === '"') inStr = true
  else if (ch === '{') { if (depth++ === 0) start = i }
  else if (ch === '}' && --depth === 0) evs.push(JSON.parse(raw.slice(start, i + 1)))
}
const filter = process.argv[3] ?? ''
const rows = evs
  .map((e) => ({ url: e.event?.request?.url ?? '', method: e.event?.request?.method, outcome: e.outcome, cpu: e.cpuTime, wall: e.wallTime, status: e.event?.response?.status }))
  .filter((r) => r.url.includes(filter))
const mode = process.argv[4] ?? 'rows'
if (mode === 'rows') {
  for (const r of rows) console.log(`${r.method} ${r.url.replace(/^https:\/\/[^/]+/, '').replace(/([?&](code|state)=)[^&]+/g, '$1…')}  status=${r.status} outcome=${r.outcome} cpu=${r.cpu}ms wall=${r.wall}ms`)
} else {
  // percentile summary (nearest-rank) of cpuTime
  const cpu = rows.map((r) => r.cpu).filter((x) => typeof x === 'number').sort((a, b) => a - b)
  // p * N / 100, not (p / 100) * N: the latter can overshoot an integer (0.07 * 100) and bump the rank.
  // Note: for N < 100, p99 is the max.
  const pct = (p) => cpu[Math.max(0, Math.ceil((p * cpu.length) / 100) - 1)]
  if (cpu.length === 0) { console.log(`${filter}: n=0`); process.exit(0) }
  console.log(`${filter}: n=${cpu.length} p50=${pct(50)}ms p99=${pct(99)}ms max=${cpu.at(-1)}ms min=${cpu[0]}ms outcomes=${[...new Set(rows.map((r) => r.outcome))].join('/')}`)
}
console.error(`events=${evs.length} matched=${rows.length}`)
