// The encrypted store for users' model API keys (H5-MODELS D-79, D-84). AES-GCM 256 with the Worker secret
// MODEL_KEY_SECRET (32 random bytes, base64); a random 12-byte IV per encryption. The associated data binds a ciphertext
// to `user id | model id | base URL`: moved to another row, another account or another endpoint, it no longer decrypts.

export const KEY_VERSION = 1 // which secret encrypted a row; a rotation adds a second secret and a version 2

export class KeyBoxUnavailable extends Error {}

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const aad = (userId: string, modelId: string, baseUrl: string) => new TextEncoder().encode(`${userId}|${modelId}|${baseUrl}`)

async function secretKey(secret: string | undefined): Promise<CryptoKey> {
  let raw: Uint8Array
  try {
    raw = unb64(secret ?? '')
  } catch {
    throw new KeyBoxUnavailable('MODEL_KEY_SECRET is not base64')
  }
  if (raw.length !== 32) throw new KeyBoxUnavailable('MODEL_KEY_SECRET must be 32 bytes')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealKey(secret: string | undefined, plain: string, userId: string, modelId: string, baseUrl: string) {
  const k = await secretKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, modelId, baseUrl) }, k, new TextEncoder().encode(plain))
  return { ct: b64(ct), iv: b64(iv), hint: plain.slice(-4), version: KEY_VERSION }
}

/** The key, or null when it does not decrypt for this row (moved, tampered, or another endpoint). */
export async function openKey(secret: string | undefined, ct: string, iv: string, userId: string, modelId: string, baseUrl: string): Promise<string | null> {
  const k = await secretKey(secret)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: aad(userId, modelId, baseUrl) }, k, unb64(ct))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
