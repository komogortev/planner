// A scripted stand-in for the Worker, small enough to read in full. It follows the contract of H1-ENTRIES §6 and
// H1-S2-BACKEND (status values, per-account version counter, pull after a cursor, 401 / 429 / 5xx on demand) — NOT the
// Worker's internals; the Worker has its own 122 tests. What it lets a test do is run two devices against one "server".
import type { Entry } from '@/domain/entry'

type Row = Omit<Entry, 'serverVersion'> & { version: number }
type Req = { path: string; method: string; body: unknown; auth: string | null }

export class FakeServer {
  rows = new Map<string, Row>()
  seq = 0
  /** token → user id. A token not in here gets 401. */
  tokens = new Map<string, string>([['tok-a', 'user-a']])
  requests: Req[] = []
  /** Answer the next requests with these instead of handling them, front first. */
  script: (() => Response)[] = []
  /** Entity ids the server refuses (status `rejected`). */
  reject = new Set<string>()
  /** Entity ids it answers `retry` for, once. */
  retryOnce = new Set<string>()

  static json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const auth = new Headers(init.headers).get('Authorization')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    this.requests.push({ path: url.pathname + url.search, method: init.method ?? 'GET', body, auth })
    const scripted = this.script.shift()
    if (scripted) return scripted()
    const user = this.tokens.get(auth?.replace(/^Bearer /, '') ?? '')
    if (!user) return FakeServer.json({ error: 'signed out' }, 401)
    if (url.pathname === '/me') return FakeServer.json({ id: user, email: `${user}@example.com`, name: null })
    if (url.pathname === '/sync/push') return FakeServer.json({ results: (body.mutations as { entityId: string; payload: Omit<Entry, 'serverVersion'> }[]).map((m) => this.apply(m)) })
    if (url.pathname === '/sync/pull') {
      const since = Number(url.searchParams.get('since'))
      const limit = Number(url.searchParams.get('limit'))
      const all = [...this.rows.values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version)
      const changes = all.slice(0, limit).map(({ version, ...e }) => ({ ...e, serverVersion: version }))
      return FakeServer.json({ changes, cursor: changes.length ? changes[changes.length - 1]!.serverVersion : since, more: all.length > limit })
    }
    return FakeServer.json({ error: 'not found' }, 404)
  }

  private apply(m: { entityId: string; payload: Omit<Entry, 'serverVersion'> }) {
    if (this.reject.has(m.entityId)) return { entityId: m.entityId, status: 'rejected', error: 'body: refused by the test server' }
    if (this.retryOnce.delete(m.entityId)) return { entityId: m.entityId, status: 'retry' }
    const cur = this.rows.get(m.entityId)
    const same = cur && cur.body === m.payload.body && cur.deletedAt === m.payload.deletedAt
    if (same) return { entityId: m.entityId, status: 'duplicate', serverVersion: cur.version }
    const version = ++this.seq
    this.rows.set(m.entityId, { ...m.payload, version })
    return { entityId: m.entityId, status: 'applied', serverVersion: version }
  }

  /** Put an entry on the server as if another device had pushed it. */
  seed(id: string, body: string, createdAt = '2026-10-10T10:00:00.000Z'): number {
    const version = ++this.seq
    this.rows.set(id, { id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, version })
    return version
  }

  count = (path: string) => this.requests.filter((r) => r.path.startsWith(path)).length
}
