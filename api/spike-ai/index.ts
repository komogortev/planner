// H5 S1 step 0 spike (docs/H5-S1-SPIKE.md). Throwaway: deployed as its own Worker (`planner-spike-ai`) with its own D1
// (`planner-spike`), never touching production. Deleted when the spike closes.
//
// It answers one question with evidence: does a long model call finish (and land in D1) when the client that started it
// disconnects? Three ways to run the same job are compared — a plain await (negative control: expected to be cut), the
// same job under ctx.waitUntil (docs: at most ~30 s after the disconnect), and a Workflow step (docs: no wall-clock limit
// per step). A job is either a timer (free, deterministic) or a real provider call (the owner's key, capped).
//
// No auth: every prompt is a fixed synthetic one, provider calls stop at PROVIDER_CALL_CAP for the Worker's lifetime,
// and a rate limit guards the routes. Rows hold no secrets and no provider error bodies (H5-MODELS D-88).
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'

interface Env {
  DB: D1Database
  CALL_WF: Workflow<Job>
  RL: RateLimit
  ANTHROPIC_KEY?: string
  ANTHROPIC_MODEL: string
  OAI_KEY?: string
  OAI_BASE: string
  OAI_MODEL: string
  OAI_MAX_FIELD: string // 'max_tokens' or 'max_completion_tokens' — providers differ
  PROVIDER_CALL_CAP: string
}

type Mode = 'plain' | 'wu' | 'wf'
type Fmt = 'anthropic' | 'openai'
type Size = 'small' | 'cut' | 'harness' | 'long'
interface Job {
  id: string
  kind: 'timer' | 'call'
  mode: Mode | 'cron'
  ms?: number
  fmt?: Fmt
  size?: Size
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT, mode TEXT, fmt TEXT, size TEXT, target_ms INTEGER, status TEXT, http INTEGER,
  stop TEXT, err TEXT, tokens_in INTEGER, tokens_out INTEGER, reply_bytes INTEGER, reply_head TEXT,
  started_at INTEGER, last_beat INTEGER, finished_at INTEGER)`
const ARM = `CREATE TABLE IF NOT EXISTS cron_arm (one INTEGER PRIMARY KEY CHECK (one = 1), job TEXT NOT NULL)`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const json = (body: unknown, status = 200) => Response.json(body, { status })

async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([db.prepare(SCHEMA), db.prepare(ARM)])
}

async function insertRow(env: Env, j: Job): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO runs (id, kind, mode, fmt, size, target_ms, status, started_at, last_beat) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)',
  ).bind(j.id, j.kind, j.mode, j.fmt ?? null, j.size ?? null, j.ms ?? null, 'running', Date.now()).run()
}

// A heartbeat every 5 s while the job runs: when the runtime cancels the job, the last beat says when.
async function withBeat<T>(env: Env, id: string, work: Promise<T>): Promise<T> {
  let done = false
  const beat = (async () => {
    while (!done) {
      await sleep(5000)
      if (!done) await env.DB.prepare('UPDATE runs SET last_beat = ?2 WHERE id = ?1').bind(id, Date.now()).run()
    }
  })()
  try {
    return await work
  } finally {
    done = true
    void beat
  }
}

// ---- provider calls: the two request formats of H5-MODELS D-81, plain fetch ----

const OBJECTS = ['kettle', 'umbrella', 'stapler', 'bicycle', 'lamp', 'notebook', 'backpack', 'scissors', 'toaster', 'clock']
const ACTS = ['call the plumber about', 'buy a new', 'return the borrowed', 'fix the', 'ask Sam about the', 'clean the']
function harnessPrompt(): string {
  // ~60 synthetic notes shaped like real captures; the reply shape mimics the harness (JSON object with a tasks list).
  const notes = Array.from({ length: 60 }, (_, i) => {
    const day = String(1 + (i % 12)).padStart(2, '0')
    return `- n${i + 1} (2026-10-${day} ${String(8 + (i % 10)).padStart(2, '0')}:15): ${ACTS[i % ACTS.length]} ${OBJECTS[i % OBJECTS.length]}${i % 7 === 0 ? ' — done' : ''}${i % 5 === 0 ? ' by Friday' : ''}`
  }).join('\n')
  return `You read short personal notes and derive tasks.\n\nNotes:\n${notes}\n\nReply with ONE JSON object and nothing else:\n{"tasks":[{"text":"<one action>","sourceNotes":["n1"],"due":"YYYY-MM-DD or null","state":"open|done"}],"questions":[{"task":"<task text>","question":"<short question>"}]}\nMerge notes about the same action into one task. Ask at most 5 questions.`
}
const LONG = 'Write 150 numbered sentences, each describing a different everyday object in about 20 words. Do not stop early and do not add anything else.'
const PROMPTS: Record<Size, { prompt: () => string; maxTokens: number }> = {
  small: { prompt: () => 'Reply with exactly this JSON and nothing else: {"ok":true}', maxTokens: 2000 },
  cut: { prompt: () => LONG, maxTokens: 64 }, // must come back marked as cut off (D-85)
  harness: { prompt: harnessPrompt, maxTokens: 16000 },
  long: { prompt: () => LONG, maxTokens: 16000 },
}

interface CallResult { http: number; stop: string | null; err: string | null; tokensIn: number | null; tokensOut: number | null; text: string }

async function callAnthropic(env: Env, size: Size): Promise<CallResult> {
  const p = PROMPTS[size]
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL, max_tokens: p.maxTokens, messages: [{ role: 'user', content: p.prompt() }] }),
  })
  const body = (await res.json().catch(() => null)) as Record<string, any> | null
  if (!res.ok) return { http: res.status, stop: null, err: String(body?.error?.type ?? 'unparsed'), tokensIn: null, tokensOut: null, text: '' }
  const text = (body?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
  return { http: res.status, stop: body?.stop_reason ?? null, err: null, tokensIn: body?.usage?.input_tokens ?? null, tokensOut: body?.usage?.output_tokens ?? null, text }
}

async function callOpenAi(env: Env, size: Size): Promise<CallResult> {
  const p = PROMPTS[size]
  const res = await fetch(`${env.OAI_BASE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OAI_KEY ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.OAI_MODEL, [env.OAI_MAX_FIELD]: p.maxTokens, messages: [{ role: 'user', content: p.prompt() }] }),
  })
  const raw = (await res.json().catch(() => null)) as unknown
  const body = (Array.isArray(raw) ? raw[0] : raw) as Record<string, any> | null // some compatibility layers wrap errors in a list
  if (!res.ok) return { http: res.status, stop: null, err: String(body?.error?.code ?? body?.error?.type ?? body?.error?.status ?? 'unparsed'), tokensIn: null, tokensOut: null, text: '' }
  const choice = body?.choices?.[0]
  return { http: res.status, stop: choice?.finish_reason ?? null, err: null, tokensIn: body?.usage?.prompt_tokens ?? null, tokensOut: body?.usage?.completion_tokens ?? null, text: String(choice?.message?.content ?? '') }
}

// ---- the job, identical under every mode ----

async function runJob(env: Env, j: Job): Promise<void> {
  if (j.kind === 'timer') {
    await withBeat(env, j.id, sleep(j.ms ?? 0))
    await env.DB.prepare("UPDATE runs SET status = 'ok', finished_at = ?2 WHERE id = ?1").bind(j.id, Date.now()).run()
    return
  }
  let r: CallResult
  try {
    r = await withBeat(env, j.id, j.fmt === 'anthropic' ? callAnthropic(env, j.size!) : callOpenAi(env, j.size!))
  } catch (e) {
    r = { http: 0, stop: null, err: `fetch: ${e instanceof Error ? e.name : 'error'}`, tokensIn: null, tokensOut: null, text: '' }
  }
  const cutOff = r.stop === 'max_tokens' || r.stop === 'length'
  const status = r.err ? 'error' : cutOff ? 'cut_off' : 'ok'
  await env.DB.prepare(
    'UPDATE runs SET status = ?2, http = ?3, stop = ?4, err = ?5, tokens_in = ?6, tokens_out = ?7, reply_bytes = ?8, reply_head = ?9, finished_at = ?10 WHERE id = ?1',
  ).bind(j.id, status, r.http, r.stop, r.err, r.tokensIn, r.tokensOut, r.text.length, cutOff ? null : r.text.slice(0, 160), Date.now()).run()
}

async function providerCallsLeft(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE kind = 'call'").first<{ n: number }>()
  return Number(env.PROVIDER_CALL_CAP) - (row?.n ?? 0)
}

export class CallWorkflow extends WorkflowEntrypoint<Env, Job> {
  async run(event: Readonly<WorkflowEvent<Job>>, step: WorkflowStep): Promise<string> {
    // No retries: a retried provider call is a second paid call.
    await step.do('job', { retries: { limit: 0, delay: 1000 }, timeout: '15 minutes' }, async () => {
      await runJob(this.env, event.payload)
      return 'done'
    })
    return 'done'
  }
}

async function start(env: Env, ctx: ExecutionContext, j: Job): Promise<Response> {
  await insertRow(env, j)
  if (j.mode === 'wf') {
    await env.CALL_WF.create({ id: j.id, params: j })
    return json({ id: j.id, started: 'workflow' }, 202)
  }
  const work = runJob(env, j)
  if (j.mode === 'wu') ctx.waitUntil(work)
  await work
  const row = await env.DB.prepare('SELECT * FROM runs WHERE id = ?1').bind(j.id).first()
  return json(row)
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const ip = req.headers.get('cf-connecting-ip') ?? 'none'
    if (!(await env.RL.limit({ key: ip })).success) return json({ error: 'rate_limited' }, 429)
    await ensureSchema(env.DB)
    const q = url.searchParams
    const mode = (q.get('mode') ?? 'plain') as Mode
    if (!['plain', 'wu', 'wf'].includes(mode)) return json({ error: 'mode' }, 400)
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`

    if (req.method === 'POST' && url.pathname === '/t/timer') {
      const ms = Math.min(Number(q.get('ms') ?? 60000), 600000)
      return start(env, ctx, { id, kind: 'timer', mode, ms })
    }
    if (req.method === 'POST' && url.pathname === '/t/call') {
      const fmt = q.get('fmt') as Fmt
      const size = (q.get('size') ?? 'small') as Size
      if (!['anthropic', 'openai'].includes(fmt) || !(size in PROMPTS)) return json({ error: 'fmt/size' }, 400)
      if (fmt === 'anthropic' ? !env.ANTHROPIC_KEY : !env.OAI_KEY || !env.OAI_BASE) return json({ error: 'no_key' }, 409)
      if ((await providerCallsLeft(env)) <= 0) return json({ error: 'cap_reached' }, 429)
      return start(env, ctx, { id, kind: 'call', mode, fmt, size })
    }
    if (req.method === 'POST' && url.pathname === '/t/cron/arm') {
      // Arms one cron run: the next scheduled tick runs this job once, then disarms (proves cron wall time for S3).
      const ms = Math.min(Number(q.get('ms') ?? 60000), 600000)
      await env.DB.prepare('INSERT OR REPLACE INTO cron_arm (one, job) VALUES (1, ?1)').bind(JSON.stringify({ kind: 'timer', ms })).run()
      return json({ armed: true, ms })
    }
    if (req.method === 'GET' && url.pathname === '/t/rows') {
      const { results } = await env.DB.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 50').all()
      return json({ callsLeft: await providerCallsLeft(env), rows: results })
    }
    return json({ error: 'not_found' }, 404)
  },

  async scheduled(_ev: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env.DB)
    const armed = await env.DB.prepare('SELECT job FROM cron_arm WHERE one = 1').first<{ job: string }>()
    if (!armed) return
    await env.DB.prepare('DELETE FROM cron_arm WHERE one = 1').run()
    const spec = JSON.parse(armed.job) as { ms: number }
    const j: Job = { id: `cron-${Date.now().toString(36)}`, kind: 'timer', mode: 'cron', ms: spec.ms }
    await insertRow(env, j)
    await runJob(env, j)
  },
} satisfies ExportedHandler<Env>
