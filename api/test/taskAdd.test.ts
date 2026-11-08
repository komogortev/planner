// D-141: a Task added from outside the app (scripts/task-add.mjs) lands as the push route would store it, every device pulls
// it, a device's replay of it is a duplicate, and asking again for the same source writes nothing — even after the owner
// deleted it. The SQL here is the script's own, run against a freshly migrated local D1. Synthetic data only.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { cleanRecord } from '../../src/domain/records'
import { insertStatements, planTaskAdd, sameOpenTask, taskIdFor, type TaskAddPlan } from '../scripts/taskAdd'
import { pullAll, pushRecords } from '../src/records'

const NOW = '2026-11-08T12:00:00.000Z'

async function account(email: string) {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(id, email, null, Date.now()).run()
  return id
}
const head = async (userId: string) => (await env.DB.prepare('SELECT version_seq FROM users WHERE id = ?').bind(userId).first<{ version_seq: number }>())!.version_seq
const run = async (userId: string, plan: TaskAddPlan) => {
  for (const s of insertStatements(userId, plan, 1)) await env.DB.prepare(s).run()
}
const plan = (over: Partial<Parameters<typeof planTaskAdd>[0]> = {}) => {
  const p = planTaskAdd({ source: 'gmail:19a5c3f0e2b7d811', text: "Contact the municipality for details (Longueuil's letter)", due: null, now: NOW, ...over })
  if (!p.ok) throw new Error(p.error)
  return p.value
}

describe('planTaskAdd', () => {
  it('builds an owner task the validator accepts unchanged, in its field order', () => {
    const p = plan({ due: '2026-11-20' })
    expect(p.fields).toMatchObject({ state: 'open', by: 'owner', editedAt: NOW, runId: null, sourceEntryIds: [], due: '2026-11-20', followUpOn: null })
    const again = cleanRecord('task', { id: p.id, ...p.fields, deletedAt: null })
    expect(again.ok && JSON.stringify(again.value.fields)).toBe(p.data)
  })

  it('derives the id from the source alone', () => {
    expect(plan().id).toBe(plan({ text: 'Other words', now: '2026-12-01T00:00:00.000Z' }).id)
    expect(plan().id).not.toBe(plan({ source: 'gmail:19a5c3f0e2b7d812' }).id)
    expect(plan().id).toBe(taskIdFor('gmail:19a5c3f0e2b7d811'))
  })

  it('refuses a bad source, an empty text or a bad date', () => {
    expect(planTaskAdd({ source: '19a5c3f0', text: 'x', due: null, now: NOW }).ok).toBe(false)
    expect(planTaskAdd({ source: "gmail:a'b", text: 'x', due: null, now: NOW }).ok).toBe(false)
    expect(planTaskAdd({ source: 'gmail:abc', text: '   ', due: null, now: NOW }).ok).toBe(false)
    expect(planTaskAdd({ source: 'gmail:abc', text: 'x', due: '20/11/2026', now: NOW }).ok).toBe(false)
  })

  it('finds an open task with the same text, not a done one', () => {
    const p = plan({ text: 'Call the city' })
    const row = (state: string, text = 'call the city.') => ({ id: `t-${state}`, data: JSON.stringify({ text, state }) })
    expect(sameOpenTask(p, [row('done'), row('open')])).toBe('t-open')
    expect(sameOpenTask(p, [row('done'), row('open', 'Call the bank')])).toBeNull()
  })
})

describe('insertStatements on D1', () => {
  it('stores the task on the next version, and a device pulls it', async () => {
    const me = await account('owner@example.test')
    const before = await head(me)
    const p = plan()
    await run(me, p)
    expect(await head(me)).toBe(before + 1)
    const pulled = await pullAll(env.DB, me, before, 100)
    expect(pulled.records).toEqual([{ recordKind: 'task', id: p.id, ...p.fields, deletedAt: null, serverVersion: before + 1 }])
  })

  it("a device's replay of the pulled row is a duplicate, not an edit", async () => {
    const me = await account('owner@example.test')
    const p = plan()
    await run(me, p)
    const v = await head(me)
    const [res] = await pushRecords(env.DB, me, [{ recordKind: 'task', entityId: p.id, op: 'upsert', baseVersion: v, payload: { id: p.id, ...p.fields, deletedAt: null } }])
    expect(res).toEqual({ entityId: p.id, status: 'duplicate', serverVersion: v })
  })

  it('a second run writes nothing, even after the owner finished or deleted the task', async () => {
    const me = await account('owner@example.test')
    const p = plan()
    await run(me, p)
    const v = await head(me)
    await run(me, plan({ text: 'Different words, same email' }))
    expect(await head(me)).toBe(v)

    await env.DB.prepare("UPDATE records SET deleted_at = '2026-11-09T00:00:00.000Z' WHERE user_id = ? AND id = ?").bind(me, p.id).run()
    await run(me, p)
    const row = await env.DB.prepare('SELECT data, deleted_at, server_version FROM records WHERE user_id = ? AND id = ?').bind(me, p.id).first()
    expect(row).toEqual({ data: p.data, deleted_at: '2026-11-09T00:00:00.000Z', server_version: v })
    expect(await head(me)).toBe(v)
  })

  it('touches only the named account, and keeps an apostrophe in the text', async () => {
    const me = await account('owner@example.test')
    const other = await account('other@example.test')
    const otherHead = await head(other)
    const p = plan()
    await run(me, p)
    expect(await head(other)).toBe(otherHead)
    expect((await pullAll(env.DB, other, 0, 100)).records).toBeUndefined()
    const stored = await env.DB.prepare('SELECT data FROM records WHERE user_id = ? AND id = ?').bind(me, p.id).first<{ data: string }>()
    expect(JSON.parse(stored!.data).text).toBe("Contact the municipality for details (Longueuil's letter)")
  })
})
