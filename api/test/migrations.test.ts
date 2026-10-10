import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const tables = async () =>
  (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>())
    .results.map((r) => r.name)

describe('migrations', () => {
  it('build the full schema on an empty database', async () => {
    // setup.ts already migrated this test's fresh database
    expect(await tables()).toEqual(
      expect.arrayContaining(['users', 'identities', 'sessions', 'invites', 'entries', 'entry_revisions']),
    )
    expect(await tables()).not.toContain('spike_notes')
  })

  // Production today: 0001–0003 applied, one account signed in. 0004 must keep it and its session.
  it('upgrade a production-shaped database without losing its account', async () => {
    await reset()
    const upTo3 = env.TEST_MIGRATIONS.filter((m) => m.name < '0004')
    expect(upTo3.map((m) => m.name)).toEqual(['0001_spike_notes.sql', '0002_accounts.sql', '0003_drop_spike_notes.sql'])
    await applyD1Migrations(env.DB, upTo3)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'owner@example.com', 'Owner', 1)"),
      env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('github', '101', 'u1')"),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', 'u1', 1, 9e15)"),
    ])

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

    expect(await env.DB.prepare('SELECT id, email, version_seq, disabled_at FROM users').all()).toMatchObject({
      results: [{ id: 'u1', email: 'owner@example.com', version_seq: 0, disabled_at: null }],
    })
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n).toBe(1)
  })
})
