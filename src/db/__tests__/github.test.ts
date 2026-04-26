import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubError, getDataJson, putDataJson } from '../github'

function mockResponse(init: {
  status: number
  body?: unknown
  headers?: Record<string, string>
}): Response {
  const headers = new Headers(init.headers ?? {})
  return new Response(init.body !== undefined ? JSON.stringify(init.body) : null, {
    status: init.status,
    headers,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('putDataJson', () => {
  it('returns the new sha on 200', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({ status: 200, body: { content: { sha: 'newsha123' } } }),
    )
    const out = await putDataJson('pat', 'me', 'data', '{}', 'oldsha', 'msg')
    expect(out.sha).toBe('newsha123')
  })

  it('returns the new sha on 201 (first-ever PUT)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({ status: 201, body: { content: { sha: 'firstsha' } } }),
    )
    const out = await putDataJson('pat', 'me', 'data', '{}', undefined, 'msg')
    expect(out.sha).toBe('firstsha')
  })

  it('throws conflict on 409', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({ status: 409, body: { message: 'sha mismatch' } }),
    )
    await expect(putDataJson('pat', 'me', 'data', '{}', 'stale', 'msg')).rejects.toMatchObject({
      kind: 'conflict',
    })
  })

  it('throws conflict on 422 (sha invalid)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({ status: 422, body: { message: 'sha is required' } }),
    )
    await expect(putDataJson('pat', 'me', 'data', '{}', 'stale', 'msg')).rejects.toMatchObject({
      kind: 'conflict',
    })
  })

  it('throws unauthorized on 401', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({ status: 401 }),
    )
    await expect(putDataJson('pat', 'me', 'data', '{}', 'sha', 'msg')).rejects.toMatchObject({
      kind: 'unauthorized',
    })
  })

  it('throws rate-limited on 403 with X-RateLimit-Remaining: 0', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
        },
      }),
    )
    await expect(putDataJson('pat', 'me', 'data', '{}', 'sha', 'msg')).rejects.toMatchObject({
      kind: 'rate-limited',
    })
  })

  it('throws network when fetch rejects', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('failed to fetch'))
    await expect(putDataJson('pat', 'me', 'data', '{}', 'sha', 'msg')).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('encodes UTF-8 content as base64 in the request body', async () => {
    let captured: { body?: string } = {}
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_url, init) => {
      captured = { body: init?.body as string }
      return mockResponse({ status: 200, body: { content: { sha: 'x' } } })
    })
    await putDataJson('pat', 'me', 'data', 'café 🏠', 'sha', 'msg')
    const sent = JSON.parse(captured.body!) as { content: string; sha: string }
    expect(sent.sha).toBe('sha')
    // Decode and verify UTF-8 round-trip
    const binary = atob(sent.content)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    expect(new TextDecoder('utf-8').decode(bytes)).toBe('café 🏠')
  })

  it('omits sha from body on first-ever PUT', async () => {
    let captured: { body?: string } = {}
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_url, init) => {
      captured = { body: init?.body as string }
      return mockResponse({ status: 201, body: { content: { sha: 'x' } } })
    })
    await putDataJson('pat', 'me', 'data', '{}', undefined, 'msg')
    const sent = JSON.parse(captured.body!) as { content: string; sha?: string }
    expect(sent.sha).toBeUndefined()
  })
})

describe('getDataJson', () => {
  it('decodes base64 content and returns sha', async () => {
    const text = '{"hello": "world"}'
    // Base64-encode to mimic GitHub response (newlines simulate column-60 wrapping)
    const b64 = btoa(text)
    const wrapped = b64.replace(/(.{60})/g, '$1\n')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({
        status: 200,
        body: { content: wrapped, encoding: 'base64', sha: 'abc123' },
      }),
    )
    const out = await getDataJson('pat', 'me', 'data')
    expect(out.rawText).toBe(text)
    expect(out.sha).toBe('abc123')
  })

  it('throws not-found with PAT-propagation hint on 404', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse({ status: 404 }))
    try {
      await getDataJson('pat', 'me', 'data')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError)
      expect((err as GitHubError).kind).toBe('not-found')
      expect((err as GitHubError).userMessage).toContain('30 seconds')
      expect((err as GitHubError).userMessage).toContain('No data.json yet')
    }
  })

  it('decodes UTF-8 multi-byte content correctly', async () => {
    const text = '{"emoji":"🏠","accent":"café"}'
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const b64 = btoa(binary)
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockResponse({
        status: 200,
        body: { content: b64, encoding: 'base64', sha: 'utf8sha' },
      }),
    )
    const out = await getDataJson('pat', 'me', 'data')
    expect(out.rawText).toBe(text)
  })
})
