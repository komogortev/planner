import { describe, expect, it, vi } from 'vitest'
import { connectGithub, disconnectGithub, expiryText, getGithub, IntegrationsError } from '../github'

const API = 'https://api.test'
const client = (fetchImpl: typeof fetch) => ({ fetchImpl, apiUrl: API, token: 'tok' })
const DAY = 86_400_000

describe('Worker client', () => {
  it('sends the token in the connect body only, never in the URL', async () => {
    const f = vi.fn(async () => Response.json({ provider: 'github', connected: true, login: 'octo', keyHint: '9z8y', expiresAt: null, createdAt: 1, updatedAt: 1 }))
    await connectGithub('github_pat_SECRET_9z8y', client(f))
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API}/me/integrations/github`)
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ token: 'github_pat_SECRET_9z8y' })
    expect(url).not.toContain('SECRET')
  })

  it('reads and removes the connection', async () => {
    const f = vi.fn(async () => Response.json({ provider: 'github', connected: false }))
    expect(await getGithub(client(f))).toEqual({ provider: 'github', connected: false })
    const d = vi.fn(async () => Response.json({ deleted: true }))
    expect(await disconnectGithub(client(d))).toEqual({ deleted: true })
    expect((d.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE')
  })

  it("turns failures into one readable message, keeping the Worker's own words", async () => {
    const fail = (status: number, body: unknown = {}) => client(async () => Response.json(body, { status }))
    await expect(connectGithub('x', fail(400, { error: 'GitHub rejected this token.' }))).rejects.toThrow('GitHub rejected this token.')
    await expect(getGithub(fail(503))).rejects.toThrow('Integrations are not set up on the server yet.')
    await expect(getGithub(fail(401))).rejects.toThrow('Signed out. Sign in again.')
    await expect(getGithub(client(async () => { throw new TypeError('offline') }))).rejects.toThrow('No connection to the server.')
    await expect(getGithub({ fetchImpl: vi.fn(), apiUrl: API, token: null })).rejects.toBeInstanceOf(IntegrationsError)
  })
})

describe('expiryText', () => {
  const now = Date.UTC(2026, 9, 16, 12)
  it('warns from 14 days out and when expired, and says plainly when there is no date', () => {
    expect(expiryText(null, now)).toEqual({ text: 'no expiry date', warn: false })
    expect(expiryText(now - 1, now)).toMatchObject({ warn: true, text: expect.stringMatching(/^expired/) })
    expect(expiryText(now + DAY / 2, now)).toEqual({ text: 'expires tomorrow', warn: true })
    expect(expiryText(now + 14 * DAY, now)).toEqual({ text: 'expires in 14 days', warn: true })
    expect(expiryText(now + 15 * DAY, now)).toMatchObject({ warn: false, text: expect.stringMatching(/^expires /) })
  })
})
