import { describe, expect, it, vi } from 'vitest'
import { STOP_GRACE_MS, createDictation, errorMessage, joinSpoken, speechCtor, type RecognitionLike, type RecognitionResultEvent } from '../dictation'

class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null
  static throwOnStart = false
  lang = ''
  continuous = true
  interimResults = false
  started = 0
  stopped = 0
  aborted = 0
  onresult: ((e: RecognitionResultEvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    FakeRecognition.last = this
  }
  start(): void {
    if (FakeRecognition.throwOnStart) throw new Error('InvalidStateError')
    this.started++
  }
  stop(): void {
    this.stopped++
  }
  abort(): void {
    this.aborted++
  }
  emit(...parts: Array<[string, boolean]>): void {
    this.onresult?.({ results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) })
  }
}

function setup(initial = '') {
  let text = initial
  const box = { set: (t: string) => { text = t } }
  const states: boolean[] = []
  const errors: string[] = []
  FakeRecognition.throwOnStart = false
  const d = createDictation({
    ctor: FakeRecognition,
    lang: 'en-CA',
    get: () => text,
    set: (t) => {
      text = t
    },
    onListening: (l) => states.push(l),
    onError: (m) => errors.push(m),
  })
  return { d, text: () => text, states, errors, rec: () => FakeRecognition.last!, box }
}

describe('joinSpoken', () => {
  it('fills an empty box and appends after existing text with one space', () => {
    expect(joinSpoken('', '  buy milk ')).toBe('buy milk')
    expect(joinSpoken('call the bank\n', 'buy milk')).toBe('call the bank buy milk')
    expect(joinSpoken('keep', '   ')).toBe('keep') // nothing heard leaves the box as it was
  })
})

describe('speechCtor', () => {
  it('finds the standard or the prefixed class, else null', () => {
    expect(speechCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
    expect(speechCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
    expect(speechCtor({})).toBeNull()
  })
})

describe('createDictation', () => {
  it('asks for one utterance with interim results in the given language', () => {
    const s = setup()
    s.d.start()
    expect(s.rec()).toMatchObject({ lang: 'en-CA', continuous: false, interimResults: true, started: 1 })
    expect(s.states).toEqual([true])
    expect(s.d.listening).toBe(true)
  })

  it('shows interim words live and keeps only final ones when it ends', () => {
    const s = setup('note:')
    s.d.start()
    s.rec().emit(['buy', false])
    expect(s.text()).toBe('note: buy')
    s.rec().emit(['buy milk', true], [' and', false])
    expect(s.text()).toBe('note: buy milk and')
    s.rec().onend!()
    expect(s.text()).toBe('note: buy milk')
    expect(s.states).toEqual([true, false])
    expect(s.d.listening).toBe(false)
  })

  it('a revised result replaces its earlier text instead of repeating it', () => {
    const s = setup()
    s.d.start()
    s.rec().emit(['by milk', false])
    s.rec().emit(['buy milk', true])
    s.rec().onend!()
    expect(s.text()).toBe('buy milk')
  })

  it('nothing heard restores the box exactly and reports nothing', () => {
    const s = setup('as typed  ')
    s.d.start()
    s.rec().onerror!({ error: 'no-speech' })
    s.rec().onend!()
    expect(s.text()).toBe('as typed  ')
    expect(s.errors).toEqual([])
  })

  it('a blocked microphone is reported', () => {
    const s = setup()
    s.d.start()
    s.rec().onerror!({ error: 'not-allowed' })
    s.rec().onend!()
    expect(s.errors).toEqual([errorMessage('not-allowed')])
  })

  it('a second start while listening opens no second session', () => {
    const s = setup()
    s.d.start()
    const first = s.rec()
    s.d.start()
    expect(s.rec()).toBe(first)
    expect(first.started).toBe(1)
  })

  it('stop asks the browser to finish; the words arrive before onend', () => {
    const s = setup()
    s.d.start()
    s.d.stop()
    expect(s.rec().stopped).toBe(1)
    expect(s.d.listening).toBe(true) // still listening until the browser ends the session
    s.rec().emit(['done', true])
    s.rec().onend!()
    expect(s.text()).toBe('done')
  })

  it('abort keeps final words, drops interim ones, and ignores later events', () => {
    const s = setup()
    s.d.start()
    const r = s.rec()
    r.emit(['kept', true], [' maybe', false])
    s.d.abort()
    expect(s.text()).toBe('kept')
    expect(r.aborted).toBe(1)
    expect(r.onresult).toBeNull() // a late result can't write into the box any more
    expect(s.states).toEqual([true, false])
  })

  it('a start the browser refuses ends listening with a message', () => {
    const s = setup('x')
    FakeRecognition.throwOnStart = true
    s.d.start()
    expect(s.d.listening).toBe(false)
    expect(s.states).toEqual([true, false])
    expect(s.text()).toBe('x')
    expect(s.errors).toHaveLength(1)
  })

  it('pieces without leading spaces (Android) are joined with one', () => {
    const s = setup()
    s.d.start()
    s.rec().emit(['buy', true], ['milk', true])
    s.rec().onend!()
    expect(s.text()).toBe('buy milk')
  })

  it('a capture that takes the text while listening is not undone', () => {
    const s = setup('old note')
    s.d.start()
    const r = s.rec()
    s.box.set('') // the capture that was saving removes the text it sent
    r.emit(['new words', true])
    expect(s.text()).toBe('') // the saved note doesn't come back
    expect(s.d.listening).toBe(false)
    expect(r.aborted).toBe(1)
    expect(s.states).toEqual([true, false])
  })

  it('another window writing the draft mid-session wins, even at the end', () => {
    const s = setup('a')
    s.d.start()
    const r = s.rec()
    r.emit(['spoken', true])
    expect(s.text()).toBe('a spoken')
    s.box.set('from the other window')
    r.onend!()
    expect(s.text()).toBe('from the other window')
    expect(s.d.listening).toBe(false)
  })

  it('a stop the browser never ends is closed after the grace time', () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      s.d.start()
      const r = s.rec()
      r.emit(['heard', true])
      s.d.stop()
      vi.advanceTimersByTime(STOP_GRACE_MS - 1)
      expect(s.d.listening).toBe(true)
      vi.advanceTimersByTime(1)
      expect(s.d.listening).toBe(false)
      expect(s.text()).toBe('heard')
      expect(r.aborted).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stop that ends normally cancels the grace timer', () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      s.d.start()
      const r = s.rec()
      s.d.stop()
      r.onend!()
      vi.advanceTimersByTime(STOP_GRACE_MS)
      expect(r.aborted).toBe(0)
      expect(s.states).toEqual([true, false])
    } finally {
      vi.useRealTimers()
    }
  })
})
