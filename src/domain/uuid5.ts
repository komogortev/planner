// Deterministic ids for harness rows (HW-HARNESS.md §3, "Idempotency"). A row's id is derived from its natural key, so
// the same result applied twice — on one device or on two — produces the same ids and sync merges them.
// RFC 4122 §4.3 (version 5, SHA-1). Synchronous and environment-free: the Worker and the app both import it.

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0

/** SHA-1 of `bytes` (FIPS 180-4). Not used for secrecy: an id derivation only. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length
  const total = ((ml + 9 + 63) >> 6) << 6
  const padded = new Uint8Array(total)
  padded.set(bytes)
  padded[ml] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(total - 8, Math.floor(ml / 0x20000000), false)
  view.setUint32(total - 4, (ml << 3) >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4, false)
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1)
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const tmp = (rotl(a, 5) + (f >>> 0) + e + k + w[t]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = tmp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h, false))
  return out
}

/** Fixed namespace for every id this app derives. Never change it: ids already synced would stop matching. */
export const PLANNER_NAMESPACE = '6f1c8a52-3d1e-4b7a-9c20-5a1e0b7d4c33'

const hexToBytes = (uuid: string): Uint8Array => {
  const hex = uuid.replace(/-/g, '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** uuid v5 of `name` inside `namespace`. */
export function uuid5(name: string, namespace: string = PLANNER_NAMESPACE): string {
  const ns = hexToBytes(namespace)
  const nm = new TextEncoder().encode(name)
  const buf = new Uint8Array(ns.length + nm.length)
  buf.set(ns)
  buf.set(nm, ns.length)
  const bytes = sha1(buf).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
