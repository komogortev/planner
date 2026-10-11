// The Capture key as a plain function (D-56): what is in the box is captured once, and only what was captured leaves it.
import { describe, expect, it } from 'vitest'
import type { CaptureResult } from '../capture'
import { createSubmitter, submitCapture, type Box } from '../submit'

const entry = (body: string) => ({ ok: true, entry: { id: 'e', body } }) as unknown as CaptureResult
const refused: CaptureResult = { ok: false, error: 'body: empty' }

function boxOf(initial: string) {
  const b = { text: initial }
  const box: Box = { get: () => b.text, set: (t) => { b.text = t } }
  return { b, box }
}
const gate = () => {
  let open!: () => void
  const wait = new Promise<void>((r) => { open = r })
  return { wait, open }
}

describe('submitCapture', () => {
  // Known positive: a normal capture sends the text and empties the box.
  it('captures the text and empties the box', async () => {
    const { b, box } = boxOf('buy milk')
    const sent: string[] = []
    const out = await submitCapture(box, async (body) => (sent.push(body), entry(body)))
    expect(sent).toEqual(['buy milk'])
    expect(out).toEqual({ kind: 'saved', sent: 'buy milk', left: '' })
    expect(b.text).toBe('')
  })

  it('nothing to capture: nothing is sent, and the box is untouched', async () => {
    for (const text of ['', '   ', '\n\t']) {
      const { b, box } = boxOf(text)
      let called = false
      expect(await submitCapture(box, async (body) => { called = true; return entry(body) })).toEqual({ kind: 'empty' })
      expect(called).toBe(false)
      expect(b.text).toBe(text)
    }
  })

  // M3: ignoring a refusal would empty the box over a note that was never captured.
  it('a refused capture keeps the text and says why', async () => {
    const { b, box } = boxOf('x'.repeat(5))
    expect(await submitCapture(box, async () => refused)).toEqual({ kind: 'error', error: 'body: empty' })
    expect(b.text).toBe('xxxxx')
  })

  it('a capture that throws keeps the text', async () => {
    const { b, box } = boxOf('keep me')
    await expect(submitCapture(box, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(b.text).toBe('keep me')
  })

  // Review finding: text typed (or dictated) while the write was running was deleted unsent.
  it('text typed while the write is running stays in the box', async () => {
    const { b, box } = boxOf('buy milk')
    const g = gate()
    const sent: string[] = []
    const run = submitCapture(box, async (body) => { sent.push(body); await g.wait; return entry(body) })
    b.text = 'buy milk and eggs' // the owner keeps typing during the write
    g.open()
    expect(await run).toEqual({ kind: 'saved', sent: 'buy milk', left: ' and eggs' })
    expect(sent).toEqual(['buy milk']) // what was captured is what was in the box when the key was pressed
    expect(b.text).toBe(' and eggs')
  })

  // A duplicate is visible; a silent loss is not.
  it('text edited INSIDE the captured text meanwhile leaves the box alone', async () => {
    const { b, box } = boxOf('buy milk')
    const g = gate()
    const run = submitCapture(box, async (body) => { await g.wait; return entry(body) })
    b.text = 'buy oat milk'
    g.open()
    expect(await run).toEqual({ kind: 'saved', sent: 'buy milk', left: 'buy oat milk' })
    expect(b.text).toBe('buy oat milk')
  })
})

describe('createSubmitter', () => {
  // M4: without the single-flight wrapper a double tap captures the same text twice.
  it('a second call while the first is still writing is dropped: one note', async () => {
    const { box } = boxOf('buy milk')
    const g = gate()
    let captures = 0
    const submit = createSubmitter(box, async (body) => { captures++; await g.wait; return entry(body) })
    const first = submit()
    const second = submit() // a double tap
    expect(await second).toBeUndefined()
    g.open()
    expect(await first).toEqual({ kind: 'saved', sent: 'buy milk', left: '' })
    expect(captures).toBe(1)
  })

  it('a refused capture does not lock the key', async () => {
    const { b, box } = boxOf('x')
    let n = 0
    const submit = createSubmitter(box, async (body) => (++n === 1 ? refused : entry(body)))
    expect(await submit()).toMatchObject({ kind: 'error' })
    expect(await submit()).toEqual({ kind: 'saved', sent: 'x', left: '' })
    expect(b.text).toBe('')
  })
})
