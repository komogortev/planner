// Voice capture (INPUT-TYPES.md V1, owner 2026-11-22): press, speak, and the words land in the capture box as text.
// It uses the browser's own speech service (the Web Speech API): no key, no Worker, no audio stored. On Chrome the
// audio goes to Google's speech service; R10's tester notice says so. Where the browser has no speech service the
// button doesn't show.
//
// One utterance per press (`continuous = false`): recognition ends by itself after a pause and the next press
// appends. Continuous mode on Android Chrome repeats earlier results in later ones, and one utterance a press avoids
// that whole class.

/** The slice of the browser's SpeechRecognition this module uses (lib.dom doesn't declare it). */
export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: RecognitionResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
export interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}
export type RecognitionCtor = new () => RecognitionLike

/** The browser's recognition class, or null where there is none (Firefox, some WebViews). */
export function speechCtor(w: unknown = globalThis): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null
}

/** The box's text with the spoken words appended: one space after existing text, nothing before an empty box. */
export function joinSpoken(base: string, spoken: string): string {
  const s = spoken.replace(/\s+/g, ' ').trim() // results come with their own leading spaces
  if (s === '') return base
  const b = base.replace(/\s+$/, '')
  return b === '' ? s : `${b} ${s}`
}

/** What the user sees for a recognition error; null = stop quietly (nothing heard, or stopped on purpose). */
export function errorMessage(code: string): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it for this site in the browser settings.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Speech to text needs a connection.'
    default:
      return `Speech to text stopped (${code}).`
  }
}

export interface DictationOptions {
  ctor: RecognitionCtor
  lang: string
  get(): string
  set(text: string): void
  onListening(listening: boolean): void
  onError(message: string): void
}

export interface Dictation {
  start(): void
  stop(): void
  /** Drop the session without keeping words not yet final (on unmount). */
  abort(): void
  readonly listening: boolean
}

/** How long after a stop request the session is closed by force when the browser never ends it (seen on Android). */
export const STOP_GRACE_MS = 2000

export function createDictation(o: DictationOptions): Dictation {
  let rec: RecognitionLike | null = null
  let base = ''
  let finals = ''
  let last = '' // what this session last put in the box
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  const close = (): RecognitionLike | null => {
    const r = rec
    if (!r) return null
    r.onresult = r.onerror = r.onend = null
    rec = null
    clearTimeout(stopTimer)
    o.onListening(false)
    return r
  }
  // The box changed under this session (a capture that was saving took its text, another window wrote the draft):
  // the other writer wins and listening ends, instead of putting the old text back.
  const write = (t: string): boolean => {
    if (o.get() !== last) {
      close()?.abort()
      return false
    }
    o.set(t)
    last = t
    return true
  }
  const finish = (): void => {
    if (!rec) return
    // A word still interim when it ended is dropped, as the browser dropped it.
    if (write(joinSpoken(base, finals))) close()
  }

  return {
    get listening() {
      return rec !== null
    },
    start() {
      if (rec) return
      const r = new o.ctor()
      r.lang = o.lang
      r.continuous = false
      r.interimResults = true
      base = o.get()
      last = base
      finals = ''
      // Rebuilt from every result each time, so a result the browser revises replaces its earlier text.
      r.onresult = (e) => {
        let fin = ''
        let interim = ''
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i]!
          const t = res[0]?.transcript ?? ''
          // Pieces are joined with a space: Android Chrome sends later pieces without a leading one.
          if (res.isFinal) fin += ` ${t}`
          else interim += ` ${t}`
        }
        finals = fin
        write(joinSpoken(base, `${fin} ${interim}`))
      }
      r.onerror = (e) => {
        const msg = errorMessage(e.error)
        if (msg) o.onError(msg)
      }
      r.onend = finish
      rec = r
      o.onListening(true)
      try {
        r.start()
      } catch {
        finish() // start() throws when a session is already running in this page
        o.onError('Speech to text could not start. Try again.')
      }
    },
    stop() {
      const r = rec
      if (!r) return
      r.stop() // the browser delivers the last result, then onend
      clearTimeout(stopTimer)
      stopTimer = setTimeout(() => {
        if (rec !== r) return
        finish()
        r.abort()
      }, STOP_GRACE_MS)
    },
    abort() {
      const r = rec
      if (!r) return
      finish()
      r.abort()
    },
  }
}
