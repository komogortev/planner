import { describe, expect, it } from 'vitest'
import { cleanBody, cleanEntry, cleanTag, isIsoDate, isIsoDateTime, isWellFormed } from '../clean'

const base = {
  id: '3f0c2a9e-5b1d-4c7a-9e2f-1a2b3c4d5e6f',
  body: 'bought milk',
  createdAt: '2026-10-10T08:00:00.000Z',
  occurredAt: null,
  categoryId: null,
  tags: [],
  origin: 'author',
  updatedAt: '2026-10-10T08:00:00.000Z',
  deletedAt: null,
}

function ok(input: unknown) {
  const r = cleanEntry(input)
  if (!r.ok) throw new Error(`expected ok, got ${r.errors.join('; ')}`)
  return r.value
}
const errorsOf = (input: unknown) => {
  const r = cleanEntry(input)
  return r.ok ? [] : r.errors
}

describe('cleanBody', () => {
  it('strips control characters but keeps tab and newline; CRLF becomes LF', () => {
    expect(cleanBody('a\u0000b\u0007c\td\r\ne\u009Bf')).toBe('abc\td\nef')
  })

  it('normalises to NFC', () => {
    expect(cleanBody('café')).toBe('café')
  })

  // A control between a letter and its combining mark must not block composition.
  it('strips before normalising', () => {
    expect(cleanBody('e\u0000́')).toBe('é')
  })

  it('is idempotent', () => {
    for (const s of ['e\u0000́ x \r\n', 'café\t', '  a\n\n  ', 'İ̖']) {
      expect(cleanBody(cleanBody(s))).toBe(cleanBody(s))
    }
  })

  it('trims trailing whitespace only', () => {
    expect(cleanBody('  indented\n\n  ')).toBe('  indented')
  })

  it('leaves markup as plain text — escaping is the renderer’s job', () => {
    expect(cleanBody('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('cleanTag', () => {
  it('drops every control (tags are one line), lowercases, normalises after lowercasing, trims', () => {
    expect(cleanTag(' Ho\nme\t ')).toBe('home')
    expect(cleanTag(cleanTag('İ̖'))).toBe(cleanTag('İ̖'))
    expect(cleanTag('İ̖')).toBe(cleanTag('İ̖').normalize('NFC'))
  })
})

describe('isWellFormed', () => {
  it('rejects unpaired surrogates, accepts pairs', () => {
    expect(isWellFormed('ok 😀')).toBe(true)
    expect(isWellFormed('note\uD83D')).toBe(false)
    expect(isWellFormed('\uDE00x')).toBe(false)
  })
})

describe('isIsoDateTime', () => {
  it('accepts exactly toISOString output', () => {
    expect(isIsoDateTime(new Date(0).toISOString())).toBe(true)
    expect(isIsoDateTime('2026-10-10T08:00:00Z')).toBe(false) // no milliseconds: sorts wrong as text
    expect(isIsoDateTime('2026-10-10T08:00:00.000+02:00')).toBe(false) // offset: sorts wrong as text
    expect(isIsoDateTime('2026-02-30T08:00:00.000Z')).toBe(false) // V8 would roll this over to 03-02
    expect(isIsoDateTime('2026-10-10T24:00:00.000Z')).toBe(false)
  })
})

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-1-5')).toBe(false)
  })
})

describe('cleanEntry', () => {
  it('accepts a full entry', () => {
    expect(ok(base)).toEqual(base)
  })

  it('is idempotent on a whole entry', () => {
    const once = ok({ ...base, body: 'e\u0000́ \r\n', tags: [' Home', 'HOME '] })
    expect(ok(once)).toEqual(once)
  })

  // Payloads are the full entry: a missing field is refused, never read as "cleared" (an edit would undelete).
  it('refuses a payload with missing fields', () => {
    const { deletedAt: _d, tags: _t, ...partial } = base
    expect(errorsOf(partial)).toEqual(['tags: missing', 'deletedAt: missing'])
  })

  // §10 Cleaning: "a 20,001-char body is accepted" must fail.
  it('accepts 20,000 characters and rejects 20,001', () => {
    expect(errorsOf({ ...base, body: 'x'.repeat(20_000) })).toEqual([])
    expect(errorsOf({ ...base, body: 'x'.repeat(20_001) })).toEqual([expect.stringMatching(/^body: 20001/)])
  })

  it('counts an emoji as one character', () => {
    expect(errorsOf({ ...base, body: '😀'.repeat(20_000) })).toEqual([])
  })

  it('refuses an oversized raw body before processing it', () => {
    expect(errorsOf({ ...base, body: 'x'.repeat(80_001) })).toEqual(['body: over 20000 characters'])
  })

  it('rejects a body that is empty after cleaning, or not a string', () => {
    expect(errorsOf({ ...base, body: '\u0000\u0001  ' })).toEqual(['body: empty'])
    expect(errorsOf({ ...base, body: 42 })).toEqual(['body: not a well-formed string'])
  })

  it('rejects lone surrogates in the body and in tags', () => {
    expect(errorsOf({ ...base, body: 'note\uD83D' })).toEqual(['body: not a well-formed string'])
    expect(errorsOf({ ...base, tags: ['a\uDE00'] })).toEqual(['tags: an item is not a well-formed string'])
  })

  // §10 Cleaning: "a foreign user_id in the payload is honoured" must fail — owner fields never pass through.
  it('drops unknown and server-owned fields', () => {
    const v = ok({ ...base, userId: 'someone-else', user_id: 'someone-else', serverVersion: 99, extra: 1 })
    expect(Object.keys(v).sort()).toEqual(
      ['body', 'categoryId', 'createdAt', 'deletedAt', 'id', 'occurredAt', 'origin', 'tags', 'updatedAt'],
    )
  })

  it('lowercases, trims and dedupes tags', () => {
    expect(ok({ ...base, tags: [' Home ', 'home', 'HOME', 'errand'] }).tags).toEqual(['home', 'errand'])
  })

  it('rejects bad tags: not an array, a non-string item, 21 distinct, one over 40, a flood', () => {
    expect(errorsOf({ ...base, tags: 'home' })).toEqual(['tags: not an array'])
    expect(errorsOf({ ...base, tags: ['ok', 3] })).toEqual(['tags: an item is not a well-formed string'])
    expect(errorsOf({ ...base, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toEqual(['tags: 21, limit 20'])
    expect(errorsOf({ ...base, tags: ['x'.repeat(41)] })).toEqual(['tags: one is over 40 characters'])
    expect(errorsOf({ ...base, tags: Array.from({ length: 50_000 }, (_, i) => `t${i}`) })).toEqual(['tags: over 20'])
  })

  it('validates each date field', () => {
    expect(errorsOf({ ...base, createdAt: 'yesterday' })).toEqual(['createdAt: not an ISO datetime'])
    expect(errorsOf({ ...base, updatedAt: 12345 })).toEqual(['updatedAt: not an ISO datetime'])
    expect(errorsOf({ ...base, deletedAt: '2026-10-10' })).toEqual(['deletedAt: not an ISO datetime or null'])
    expect(errorsOf({ ...base, occurredAt: '2026-02-30' })).toEqual(['occurredAt: not YYYY-MM-DD or null'])
    expect(errorsOf({ ...base, occurredAt: 20261010 })).toEqual(['occurredAt: not YYYY-MM-DD or null'])
    expect(ok({ ...base, deletedAt: '2026-10-11T09:00:00.000Z', occurredAt: '2026-10-09' })).toMatchObject({
      deletedAt: '2026-10-11T09:00:00.000Z',
      occurredAt: '2026-10-09',
    })
  })

  it('accepts cat-* and uuid category ids; rejects anything else', () => {
    expect(ok({ ...base, categoryId: 'cat-skill-development' }).categoryId).toBe('cat-skill-development')
    expect(ok({ ...base, categoryId: base.id }).categoryId).toBe(base.id)
    for (const bad of [' ', '\u0000', 'cat-home ', '', 7]) {
      expect(errorsOf({ ...base, categoryId: bad })).toEqual(['categoryId: not a category id or null'])
    }
  })

  it('rejects any origin but author, and a non-uuid id', () => {
    expect(errorsOf({ ...base, origin: 'ai' })).toEqual(['origin: only "author" in H1'])
    expect(errorsOf({ ...base, id: 'not-a-uuid' })).toEqual(['id: not a uuid v4'])
  })

  it('rejects non-objects', () => {
    expect(errorsOf(null)).toEqual(['not an object'])
    expect(errorsOf([base])).toEqual(['not an object'])
  })
})
