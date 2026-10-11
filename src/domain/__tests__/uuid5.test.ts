import { describe, expect, it } from 'vitest'
import { sha1, uuid5 } from '../uuid5'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const enc = (s: string) => new TextEncoder().encode(s)

describe('sha1 — published vectors (known positives for everything derived from it)', () => {
  it('FIPS 180 examples', () => {
    expect(hex(sha1(enc('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(hex(sha1(enc('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(hex(sha1(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  })

  it('crosses the 55/56/64-byte padding boundaries', () => {
    // Values measured with node:crypto (2026-10-11), fixed here so a regression names the length.
    expect(hex(sha1(enc('a'.repeat(55))))).toBe('c1c8bbdc22796e28c0e15163d20899b65621d65a')
    expect(hex(sha1(enc('a'.repeat(56))))).toBe('c2db330f6083854c99d4b5bfb6e8f29f201be699')
    expect(hex(sha1(enc('a'.repeat(64))))).toBe('0098ba824b5c16427bd7a1122a5a442a25ec644d')
  })

  it('agrees with node:crypto for assorted lengths', async () => {
    const { createHash } = await import('node:crypto')
    for (const n of [1, 7, 63, 65, 119, 120, 128, 1000]) {
      const s = 'x'.repeat(n)
      expect(hex(sha1(enc(s)))).toBe(createHash('sha1').update(s).digest('hex'))
    }
  })
})

describe('uuid5', () => {
  const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

  it('matches the published RFC 4122 value (Python docs: uuid5(NAMESPACE_DNS, "python.org"))', () => {
    expect(uuid5('python.org', DNS)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })

  it('is deterministic, version 5, variant 10xx', () => {
    const a = uuid5('entry|run')
    expect(uuid5('entry|run')).toBe(a)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('differs for a different name (negative control)', () => {
    expect(uuid5('entry|run1')).not.toBe(uuid5('entry|run2'))
  })

  it('handles non-ASCII names as UTF-8', () => {
    expect(uuid5('café?')).toBe(uuid5('café?'))
    expect(uuid5('café?')).not.toBe(uuid5('cafe?'))
  })
})
