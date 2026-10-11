// A scripted stand-in for the Worker, small enough to read in full. It follows the contract of H1-ENTRIES §6 and
// H1-S2-BACKEND (status values, per-account version counter, pull after a cursor, 401 / 429 / 5xx on demand) — NOT the
// Worker's internals; the Worker has its own 122 tests. What it lets a test do is run two devices against one "server".
import type { Entry } from '@/domain/entry'

type Row = Omit<Entry, 'serverVersion'> & { version: number }
/** A harness / widget record as stored: its wire form (`id`, own fields, `deletedAt`) plus its kind and version. */
type RecordRow = Record<string, unknown> & { recordKind: string; id: string; version: number }
type Req = { path: string; method: string; body: unknown; auth: string | null }

export class FakeServer {
  rows = new Map<string, Row>()
  /** Records by `kind/id`; they share `seq` with the entries, as the Worker's one per-account counter does. */
  records = new Map<string, RecordRow>()
  /** Send `records` with pulls. Off: an older Worker, which knows nothing of them. */
  sendRecords = true
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
  /** Send `head` (the account's newest version) with every pull, as the Worker does. Off: an older Worker (D-58). */
  sendHead = true
  /** Answer `head` with this instead of the real one: a server that lies, to prove the client cannot be looped. */
  headOverride: number | null = null
  /** After this many requests every answer is a 500 — a safety net so a client that loops FAILS a test instead of hanging it. */
  maxRequests = Infinity

  /** The database was restored to an earlier point: later versions are gone and the counter is back at `version`. */
  restoreTo(version: number): void {
    for (const [id, r] of this.rows) if (r.version > version) this.rows.delete(id)
    for (const [key, r] of this.records) if (r.version > version) this.records.delete(key)
    this.seq = version
  }

  static json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

  /** Requests being answered right now, and the most there ever were at once: two windows syncing at the same time show here. */
  inFlight = 0
  maxInFlight = 0
  /** Hold every answer this many ms, so that overlapping requests can overlap. */
  delayMs = 0

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight)
    try {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
      return await this.handle(input, init)
    } finally {
      this.inFlight--
    }
  }

  private handle = async (input: RequestInfo | URL, init: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const auth = new Headers(init.headers).get('Authorization')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    this.requests.push({ path: url.pathname + url.search, method: init.method ?? 'GET', body, auth })
    const scripted = this.script.shift()
    if (scripted) return scripted()
    if (this.requests.length > this.maxRequests) return FakeServer.json({ error: 'too many requests in one test' }, 500)
    const user = this.tokens.get(auth?.replace(/^Bearer /, '') ?? '')
    if (!user) return FakeServer.json({ error: 'signed out' }, 401)
    if (url.pathname === '/me') return FakeServer.json({ id: user, email: `${user}@example.com`, name: null })
    if (url.pathname === '/sync/push') {
      type Mutation = { entityId: string; recordKind?: string; payload: Omit<Entry, 'serverVersion'> }
      return FakeServer.json({ results: (body.mutations as Mutation[]).map((m) => (m.recordKind ? this.applyRecord(m as never) : this.apply(m))) })
    }
    if (url.pathname === '/sync/pull') {
      const since = Number(url.searchParams.get('since'))
      const limit = Number(url.searchParams.get('limit'))
      // One stream in version order, entries and records together under one cursor, as the Worker serves it.
      const all = [
        ...[...this.rows.values()].filter((r) => r.version > since).map((r) => ({ version: r.version, entry: r })),
        ...(this.sendRecords ? [...this.records.values()].filter((r) => r.version > since).map((r) => ({ version: r.version, record: r })) : []),
      ].sort((a, b) => a.version - b.version)
      const page = all.slice(0, limit)
      const changes = page.flatMap((p) => ('entry' in p ? [(({ version, ...e }) => ({ ...e, serverVersion: version }))(p.entry)] : []))
      const records = page.flatMap((p) => ('record' in p ? [(({ version, ...r }) => ({ ...r, serverVersion: version }))(p.record)] : []))
      return FakeServer.json({
        changes, ...(records.length ? { records } : {}), cursor: page.length ? page[page.length - 1]!.version : since, more: all.length > limit,
        ...(this.sendHead ? { head: this.headOverride ?? this.seq } : {}),
      })
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

  private applyRecord(m: { entityId: string; recordKind: string; payload: Record<string, unknown> }) {
    if (this.reject.has(m.entityId)) return { entityId: m.entityId, status: 'rejected', error: 'refused by the test server' }
    if (this.retryOnce.delete(m.entityId)) return { entityId: m.entityId, status: 'retry' }
    const key = `${m.recordKind}/${m.entityId}`
    const cur = this.records.get(key)
    const { version: _v, recordKind: _k, ...curFields } = (cur ?? {}) as RecordRow
    if (cur && JSON.stringify(curFields) === JSON.stringify(m.payload)) return { entityId: m.entityId, status: 'duplicate', serverVersion: cur.version }
    const version = ++this.seq
    this.records.set(key, { ...m.payload, recordKind: m.recordKind, id: m.entityId, version })
    return { entityId: m.entityId, status: 'applied', serverVersion: version }
  }

  /** Put a record on the server as if another device had pushed it. */
  seedRecord(recordKind: string, payload: Record<string, unknown> & { id: string }): number {
    const version = ++this.seq
    this.records.set(`${recordKind}/${payload.id}`, { ...payload, recordKind, version })
    return version
  }

  /** Put an entry on the server as if another device had pushed it. */
  seed(id: string, body: string, createdAt = '2026-10-10T10:00:00.000Z'): number {
    const version = ++this.seq
    this.rows.set(id, { id, body, createdAt, occurredAt: null, categoryId: null, tags: [], origin: 'author', updatedAt: createdAt, deletedAt: null, version })
    return version
  }

  count = (path: string) => this.requests.filter((r) => r.path.startsWith(path)).length
}
