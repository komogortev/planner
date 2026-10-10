#!/usr/bin/env node
// Invites (H1-ENTRIES.md §8): who may create an account. The owner runs this; there is no invite UI in H1.
//
//   node scripts/invite.mjs create <email> [--days 14] [--remote]   invite, or re-admit a revoked account
//   node scripts/invite.mjs list [--remote]                         accounts and invites
//   node scripts/invite.mjs revoke <email> [--remote]               disable the account, end its sessions, drop an unused invite
//
// Local D1 by default; production needs --remote. Emails are typed here, never committed (public repo).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const [cmd, rawEmail] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--days')
const where = flag('--remote') ? '--remote' : '--local'

function die(msg) {
  console.error(msg)
  process.exit(1)
}

// Strict, so the address can be inlined into SQL: no quote, semicolon or space can get through.
function email() {
  const e = (rawEmail ?? '').trim().toLowerCase()
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e)) die(`not an email: ${rawEmail ?? '(none)'}`)
  return e
}

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'planner', where, '--json', '--command', sql], {
    cwd: apiDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(out).map((r) => r.results ?? [])
}

const now = Date.now()
const iso = (ms) => (ms == null ? '' : new Date(ms).toISOString().slice(0, 16).replace('T', ' '))

// The account whose email this is, if any. Revoke and re-admit act on `users.email` — a provider's secondary address
// that merely linked to the account does not match, and the script says so instead of reporting a silent no-op.
const account = (e) => d1(`SELECT id, disabled_at FROM users WHERE email = '${e}'`)[0][0] ?? null

if (cmd === 'create') {
  const e = email()
  const days = Number(opt('--days', '14'))
  if (!Number.isInteger(days) || days < 1 || days > 365) die('--days must be 1..365')
  const acct = account(e)
  if (acct) {
    // An account exists: it needs no invite (its identity signs in). Only lift a revocation; keep the invite record.
    if (acct.disabled_at == null) console.log(`${e} already has an active account (${where.slice(2)}) — nothing to do`)
    else {
      d1(`UPDATE users SET disabled_at = NULL WHERE id = '${acct.id}'`)
      console.log(`re-admitted ${e} (${where.slice(2)}): revocation lifted, no invite needed`)
    }
  } else {
    d1(
      `INSERT INTO invites (email, created_at, expires_at) VALUES ('${e}', ${now}, ${now + days * 86_400_000})
         ON CONFLICT(email) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at,
           used_by = NULL, used_at = NULL`,
    )
    console.log(`invited ${e} (${where.slice(2)}), expires ${iso(now + days * 86_400_000)} UTC`)
  }
} else if (cmd === 'revoke') {
  const e = email()
  const acct = account(e)
  const [, , dropped] = d1(
    `UPDATE users SET disabled_at = ${now} WHERE email = '${e}';
     DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${e}');
     DELETE FROM invites WHERE email = '${e}' AND used_by IS NULL RETURNING email;`,
  )
  if (acct) console.log(`revoked ${e} (${where.slice(2)}): account disabled, sessions ended; its entries are kept`)
  else if (dropped.length) console.log(`withdrew the open invite for ${e} (${where.slice(2)}); there was no account`)
  else die(`no account and no open invite for ${e} (${where.slice(2)}) — nothing changed. Check the address with: list`)
} else if (cmd === 'list') {
  const [users, invites] = d1(
    `SELECT email, created_at, disabled_at, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ${now}) AS sessions FROM users u ORDER BY created_at;
     SELECT email, expires_at, used_at FROM invites ORDER BY created_at;`,
  )
  console.log(`accounts (${where.slice(2)})`)
  console.table(users.map((u) => ({ email: u.email, created: iso(u.created_at), disabled: iso(u.disabled_at), sessions: u.sessions })))
  console.log('invites')
  console.table(invites.map((i) => ({ email: i.email, expires: iso(i.expires_at), used: iso(i.used_at), open: !i.used_at && i.expires_at > now })))
} else {
  die('usage: invite.mjs create <email> [--days N] | list | revoke <email>   [--remote]')
}
