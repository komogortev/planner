// The client half of H1-ENTRIES §6 (push the outbox, pull after the cursor). Environment-light on purpose (ARCHITECTURE §3:
// `sync/` must not import Vue): the browser wiring — timers, events, reactive state — is in `./index.ts`; everything
// here takes its dependencies as arguments, so a test can run two devices against a fake server.
//
// Decisions it carries (DECISION-TREE.md): D-04 a 401 keeps every outbox row and only changes the phase · D-10/D-12
// foreground triggers, 60 s poll (the scheduling is in index.ts) · D-27 a rejected change is skipped, kept and marked ·
// D-29 pull pages of 100 and capture never waits for them · D-50 a foreign account's data is never pushed.
import type { PlannerDb } from '@/db'
import type { OutboxRow } from '@/db/schema'
import type { Entry, EntryInput } from '@/domain/entry'

/** Measured limits (H1-S2-BACKEND.md, step 7): push ≤ 50 mutations and ≤ 100 KB, pull pages of 100. */
export const PUSH_BATCH_MAX = 50
export const PUSH_BATCH_BYTES = 100_000
export const PULL_PAGE = 100
export const BACKOFF_FIRST_MS = 2_000
export const BACKOFF_MAX_MS = 300_000
const DEFAULT_RETRY_AFTER_MS = 60_000

export type SyncPhase =
  | 'idle' // everything the server knows is here and the other way round (as of lastSyncedAt)
  | 'syncing'
  | 'waiting' // a failure or a 429: the next attempt is at retryAt
  | 'offline'
  | 'auth' // the server rejected the token: notes are kept, sign in again (D-04)
  | 'account-deleted' // the account was deleted from another device (D-50)
  | 'foreign-account' // this device holds another account's notes (D-50)

export interface SyncState {
  phase: SyncPhase
  lastSyncedAt: string | null
  lastError: string | null
  /** Consecutive failed cycles; 0 after a good one. */
  failures: number
  retryAt: number | null
  /** Rows pulled since the engine started — the progress line of a first pull on a new device (D-29). */
  pulled: number
  /** True while the first pull on this device (cursor 0) is running. */
  initialPull: boolean
}

export interface EngineDeps {
  db: PlannerDb
  fetch: typeof fetch
  apiUrl: string
  token: () => string | null
  now?: () => number
  online?: () => boolean
  /** Lets a page yield between pull pages. Default: a macrotask. */
  yieldNow?: () => Promise<void>
}

/** The device was reset (sign-out, wipe) while a cycle was running: stop without touching the database or the state. */
class Cancelled extends Error {}

/** Thrown inside a cycle to end it with a phase; never escapes `run`. */
class Stop extends Error {
  constructor(readonly phase: SyncPhase, message: string, readonly delayMs?: number, readonly counts = true) {
    super(message)
  }
}

type PushResult = { entityId: string; status: 'applied' | 'duplicate' | 'rejected' | 'retry'; serverVersion?: number; conflict?: boolean; error?: string }
type PullResponse = { changes: Entry[]; cursor: number; more: boolean }

export type Group = { entityId: string; seqs: number[]; mutation: { entityId: string; op: 'upsert' | 'delete'; baseVersion: number | null; payload: EntryInput } }

/**
 * Pending outbox rows → one mutation per entity (H1-S2-BACKEND, "Client contract"): payloads are full entries, so the
 * latest one wins, and the base is the earliest row's base — the version the first of these edits was made against.
 * Groups keep the order in which their entity first appeared.
 */
export function coalesce(rows: OutboxRow[]): Group[] {
  const groups = new Map<string, OutboxRow[]>()
  for (const r of [...rows].sort((a, b) => a.seq! - b.seq!)) {
    const g = groups.get(r.entityId)
    if (g) g.push(r)
    else groups.set(r.entityId, [r])
  }
  return [...groups.values()].map((g) => {
    const first = g[0]!
    const last = g[g.length - 1]!
    return {
      entityId: first.entityId,
      seqs: g.map((r) => r.seq!),
      mutation: { entityId: first.entityId, op: last.op, baseVersion: first.baseVersion, payload: last.payload },
    }
  })
}

const encoder = new TextEncoder()
const bytes = (v: unknown) => encoder.encode(JSON.stringify(v)).length

/** The next request's worth of groups: ≤ 50 mutations and ≤ 100 KB, and always at least one. */
export function takeBatch(groups: Group[]): Group[] {
  const out: Group[] = []
  let size = 16 // {"mutations":[]}
  for (const g of groups) {
    const n = bytes(g.mutation) + 1
    if (out.length > 0 && (out.length >= PUSH_BATCH_MAX || size + n > PUSH_BATCH_BYTES)) break
    out.push(g)
    size += n
  }
  return out
}

export function backoffDelay(failures: number): number {
  return Math.min(BACKOFF_FIRST_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS)
}

const initialState = (): SyncState => ({ phase: 'idle', lastSyncedAt: null, lastError: null, failures: 0, retryAt: null, pulled: 0, initialPull: false })

export class SyncEngine {
  state: SyncState = initialState()
  private listeners = new Set<(s: SyncState) => void>()
  private running: Promise<void> | null = null
  private busy = false
  private again = false
  private userId: string | null = null
  /** Bumped by `reset()`. A cycle that started under an older value writes nothing more (review finding B). */
  private generation = 0
  private readonly now: () => number

  constructor(private readonly d: EngineDeps) {
    this.now = d.now ?? Date.now
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }

  /**
   * One sync, or a request for one if a sync is already running (it then goes round once more, so a capture that landed
   * mid-push is not left waiting for the 60 s poll). `force` ignores a pending backoff — an online event, "Sync now".
   */
  run(opts: { force?: boolean } = {}): Promise<void> {
    if (this.busy) {
      this.again = true
      return this.running ?? Promise.resolve() // `running` is assigned only after the first await; `busy` is set at once
    }
    // These phases end only by the owner acting (sign in again, clear the device), which calls `reset()` or `run({force})`.
    if (!opts.force && (this.state.phase === 'auth' || this.state.phase === 'account-deleted' || this.state.phase === 'foreign-account')) return Promise.resolve()
    if (!opts.force && this.state.retryAt !== null && this.now() < this.state.retryAt) return Promise.resolve()
    this.busy = true
    this.running = (async () => {
      do {
        this.again = false
        await this.cycle()
        // A request that arrived mid-cycle earns one more round only after a good one: after a 429, a failure or a 401 it
        // would walk straight past the backoff or the Retry-After (review finding A).
      } while (this.again && this.state.phase === 'idle')
      this.again = false
    })().finally(() => {
      this.running = null
      this.busy = false
    })
    return this.running
  }

  /** The session token changed (sign-in return, sign-out): forget what was learned about the account. */
  reset(): void {
    this.generation++
    this.userId = null
    this.set({ ...initialState(), lastSyncedAt: this.state.lastSyncedAt })
  }

  private async cycle(): Promise<void> {
    if (!this.d.token()) return this.set({ phase: 'idle' })
    if (this.d.online && !this.d.online()) return this.set({ phase: 'offline' })
    const gen = this.generation
    this.set({ phase: 'syncing', retryAt: null })
    try {
      const userId = await this.who()
      this.live(gen)
      if (!(await this.sameAccount(userId))) throw new Stop('foreign-account', 'this device holds notes of another account', undefined, false)
      await this.claimDevice(userId, gen)
      await this.push(gen)
      await this.pull(userId, gen)
      this.live(gen)
      this.set({ phase: 'idle', lastSyncedAt: new Date(this.now()).toISOString(), lastError: null, failures: 0, retryAt: null, initialPull: false })
    } catch (err) {
      if (err instanceof Cancelled || gen !== this.generation) return // reset() already set the state; this cycle is stale
      if (err instanceof Stop) {
        const failures = err.counts ? this.state.failures + 1 : this.state.failures
        const delay = err.delayMs ?? (err.phase === 'waiting' ? backoffDelay(failures) : null)
        this.set({ phase: err.phase, lastError: err.message, failures, retryAt: delay === null ? null : this.now() + delay, initialPull: false })
      } else {
        // A network failure (fetch rejects) or a local database error: back off, never lose the outbox.
        const failures = this.state.failures + 1
        const offline = this.d.online ? !this.d.online() : false
        this.set({
          phase: offline ? 'offline' : 'waiting', lastError: err instanceof Error ? err.message : String(err), failures,
          retryAt: offline ? null : this.now() + backoffDelay(failures), initialPull: false,
        })
      }
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = this.d.token()
    if (!token) throw new Stop('auth', 'signed out', undefined, false)
    const res = await this.d.fetch(`${this.d.apiUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } })
    if (res.ok) return res.json()
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
    if (res.status === 401) {
      if (body.reason === 'account-deleted') throw new Stop('account-deleted', 'this account was deleted', undefined, false)
      throw new Stop('auth', 'the server did not accept the session — sign in again', undefined, false)
    }
    if (res.status === 429) {
      const secs = Number(res.headers.get('Retry-After'))
      throw new Stop('waiting', 'too many requests — waiting', Number.isFinite(secs) && secs > 0 ? secs * 1000 : DEFAULT_RETRY_AFTER_MS)
    }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }

  private async who(): Promise<string> {
    if (this.userId) return this.userId
    const me = (await this.call('/me')) as { id?: unknown }
    if (typeof me.id !== 'string') throw new Error('/me returned no account id')
    return (this.userId = me.id)
  }

  private live(gen: number): void {
    if (gen !== this.generation) throw new Cancelled()
  }

  /**
   * The first cycle that passes the account check claims the device, so the check has something to compare with even if
   * the first pull fails before it commits (review finding C: otherwise a later sign-in as another person would push the
   * first account notes into the new account).
   */
  private async claimDevice(userId: string, gen: number): Promise<void> {
    const { db } = this.d
    await db.transaction('rw', db.syncMeta, async () => {
      this.live(gen)
      const claimed = await db.syncMeta.get(userId)
      this.live(gen) // the read waited for any clear queued ahead of this transaction; a reset it made must win
      if (!claimed) await db.syncMeta.put({ userId, cursor: 0, lastPushAt: null, lastPullAt: null })
    })
  }

  /** D-50: a device whose sync state belongs to a different account never pushes into this one. */
  private async sameAccount(userId: string): Promise<boolean> {
    const metas = await this.d.db.syncMeta.toArray()
    return metas.length === 0 || metas.some((m) => m.userId === userId)
  }

  // ── push ──────────────────────────────────────────────────────────────────

  private async push(gen: number): Promise<void> {
    const { db } = this.d
    for (;;) {
      this.live(gen)
      const pending = (await db.outbox.toArray()).filter((r) => !r.rejectedAt)
      if (pending.length === 0) return
      const batch = takeBatch(coalesce(pending))
      const body = (await this.call('/sync/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mutations: batch.map((g) => g.mutation) }),
      })) as { results?: PushResult[] }
      const results = body.results
      if (!Array.isArray(results) || results.length !== batch.length) throw new Error('push: the answer does not match the request')

      let moved = 0
      let retried = 0
      for (let i = 0; i < batch.length; i++) {
        const g = batch[i]!
        const r = results[i]!
        if (r.status === 'applied' || r.status === 'duplicate') {
          moved++
          await this.acknowledge(g, r.serverVersion, gen)
        } else if (r.status === 'rejected') {
          moved++ // the row leaves the pending set, so the loop moves on (D-27)
          await db.outbox.bulkUpdate(g.seqs.map((seq) => ({ key: seq, changes: { rejectedAt: new Date(this.now()).toISOString(), lastError: r.error ?? 'rejected by the server' } })))
        } else {
          retried++
          await db.outbox.where('seq').anyOf(g.seqs).modify((row) => { row.attempts += 1; row.lastError = 'the server asked to retry' })
        }
      }
      if (retried > 0 && moved === 0) throw new Error('push: the server asked to retry')
      if (retried > 0) throw new Error('push: part of the batch asked to retry')
    }
  }

  /** The server has this change: drop its outbox rows, record the version, and re-base what was queued meanwhile. */
  private async acknowledge(g: Group, serverVersion: number | undefined, gen: number): Promise<void> {
    const { db } = this.d
    await db.transaction('rw', db.entries, db.outbox, async () => {
      this.live(gen) // a wiped device must not get this account version stamped back onto it
      await db.outbox.bulkDelete(g.seqs)
      if (typeof serverVersion !== 'number') return
      const entry = await db.entries.get(g.entityId)
      if (entry && (entry.serverVersion === null || entry.serverVersion < serverVersion)) await db.entries.update(g.entityId, { serverVersion })
      // An edit queued while this push was in flight was made on top of THIS version, not the older one it recorded.
      await db.outbox.where('entityId').equals(g.entityId).modify((row) => { row.baseVersion = serverVersion })
    })
  }

  // ── pull ──────────────────────────────────────────────────────────────────

  private async pull(userId: string, gen: number): Promise<void> {
    const { db } = this.d
    const known = await db.syncMeta.get(userId)
    let cursor = known?.cursor ?? 0
    this.set({ initialPull: cursor === 0 })
    for (;;) {
      const page = (await this.call(`/sync/pull?since=${cursor}&limit=${PULL_PAGE}`)) as PullResponse
      if (!Array.isArray(page.changes) || typeof page.cursor !== 'number') throw new Error('pull: malformed answer')
      const next = Math.max(cursor, page.cursor)
      await db.transaction('rw', db.entries, db.outbox, db.syncMeta, async () => {
        this.live(gen) // a device cleared while the page was in flight must not receive it
        // A change to an entity with a queued local edit is not applied: the local edit wins locally until it is
        // pushed, and the server decides then (§6.2). The cursor still moves past it.
        const queued = new Set((await db.outbox.toArray()).map((r) => r.entityId))
        this.live(gen) // the read waited for any clear queued ahead of this transaction; a reset it made must win
        const apply = page.changes.filter((c) => typeof c?.id === 'string' && typeof c.body === 'string' && !queued.has(c.id))
        await db.entries.bulkPut(apply.map((c): Entry => ({
          id: c.id, body: c.body, createdAt: c.createdAt, occurredAt: c.occurredAt ?? null, categoryId: c.categoryId ?? null,
          tags: Array.isArray(c.tags) ? c.tags : [], origin: 'author', updatedAt: c.updatedAt, deletedAt: c.deletedAt ?? null, serverVersion: c.serverVersion,
        })))
        await db.syncMeta.put({ userId, cursor: next, lastPushAt: known?.lastPushAt ?? null, lastPullAt: new Date(this.now()).toISOString() })
      })
      this.set({ pulled: this.state.pulled + page.changes.length })
      if (!page.more) return
      if (next <= cursor) throw new Error('pull: the cursor did not advance')
      cursor = next
      await (this.d.yieldNow ?? (() => new Promise<void>((r) => setTimeout(r, 0))))()
    }
  }

  // ── what the owner can do about a stuck row (D-27) ────────────────────────

  /** Make every rejected row pending again (after the cause was fixed). */
  async retryRejected(): Promise<number> {
    const rejected = (await this.d.db.outbox.toArray()).filter((r) => r.rejectedAt)
    await this.d.db.outbox.bulkUpdate(rejected.map((r) => ({ key: r.seq!, changes: { rejectedAt: null, lastError: null } })))
    return rejected.length
  }

  /** Drop rejected rows. A note that never reached the server is dropped from this device too — there is nowhere else it lives. */
  async discardRejected(seqs?: number[]): Promise<number> {
    const { db } = this.d
    const rows = (await db.outbox.toArray()).filter((r) => r.rejectedAt && (!seqs || seqs.includes(r.seq!)))
    await db.transaction('rw', db.entries, db.outbox, db.syncMeta, async () => {
      await db.outbox.bulkDelete(rows.map((r) => r.seq!))
      let refetch = false
      for (const r of rows) {
        const stillQueued = await db.outbox.where('entityId').equals(r.entityId).count()
        if (stillQueued > 0) continue
        const entry = await db.entries.get(r.entityId)
        if (!entry) continue
        if (r.baseVersion === null && entry.serverVersion === null) {
          await db.entries.delete(r.entityId) // a note the server never had: nowhere else it lives
        } else if (r.baseVersion !== null) {
          // A discarded EDIT: the local copy holds the refused text, and a pull skipped the server version while the row
          // existed. Drop the local copy and pull again from the start so the server version comes back (finding D).
          await db.entries.delete(r.entityId)
          refetch = true
        }
      }
      if (refetch) await db.syncMeta.toCollection().modify((m) => { m.cursor = 0 })
    })
    return rows.length
  }
}
