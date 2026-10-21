// A stand-in model provider (openai-chat shape) for the E2E suite. The Worker refuses a localhost base URL when a model is
// saved (modelRules.cleanBaseUrl), so the suite seeds the model row directly (seed.mjs) and points it here.
// The reply is built from the request: it names the note ids found in the prompt, so the app accepts it as a real run.
//   GET  /requests   → every call seen: { path, authorization, noteIds }
//   POST /reset      → forget them, back to mode 'ok'
//   POST /mode {mode: 'ok' | 'bad'}   → 'bad' answers with text that is not the harness JSON (a negative control)
import { createServer } from 'node:http'
import { STUB_PORT } from './ports.mjs'

const seen = []
let mode = 'ok'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const read = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b)) })
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === '/requests') return json(res, 200, seen)
  if (req.method === 'POST' && url.pathname === '/reset') { seen.length = 0; mode = 'ok'; return json(res, 200, {}) }
  if (req.method === 'POST' && url.pathname === '/mode') { mode = JSON.parse(await read(req)).mode; return json(res, 200, { mode }) }
  if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
    const body = JSON.parse(await read(req))
    const text = (body.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    const noteIds = [...new Set(text.match(UUID) ?? [])]
    seen.push({ path: url.pathname, authorization: req.headers.authorization ?? '', noteIds })
    const content = mode === 'bad'
      ? 'Sorry, I could not do that.'
      : JSON.stringify({
          tasks: [{ op: 'create', ref: 't', text: 'E2E task from the stub provider', sourceEntryIds: noteIds, due: null }],
          questions: [{ taskId: 't', entryId: null, text: 'E2E question from the stub provider?' }],
        })
    return json(res, 200, { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } })
  }
  json(res, 404, { error: 'not found' })
}).listen(STUB_PORT, () => console.log(`stub provider on :${STUB_PORT}`))
