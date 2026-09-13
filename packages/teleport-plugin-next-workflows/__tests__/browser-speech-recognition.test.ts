// The dictation node is the only node whose observable behaviour arrives AFTER
// it returns, so its contract cannot be checked by reading the emitted string —
// these tests execute the real handler against a fake Web Speech API and assert
// what it dispatches.

import { nodeRegistry } from '../src/nodes'

type Handler = (config: any, context: Record<string, unknown>) => Promise<any>

const loadHandler = (): Handler => {
  const source = nodeRegistry['browser-speech-recognition'].generateHandler()
  // Same shape the generated `node-handlers-client.js` uses.
  // eslint-disable-next-line no-new-func
  return new Function(`${source}\nreturn browser_speech_recognition;`)() as Handler
}

interface FakeRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives?: number
  start: jest.Mock
  stop: jest.Mock
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

const instances: FakeRecognition[] = []

/**
 * Set to make the NEXT recogniser reject `start()`, the way a real one raises
 * `InvalidStateError` while a previous session is still releasing the device.
 * A flag rather than a mock on an existing instance: each start constructs a
 * fresh recogniser, so the throwing one does not exist yet at arrange time.
 */
let nextStartThrows = false

class FakeSpeechRecognition implements FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives?: number
  onresult: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onend: (() => void) | null = null
  start = jest.fn(() => {
    if (nextStartThrows) {
      nextStartThrows = false
      throw new Error('InvalidStateError')
    }
  })
  stop = jest.fn(() => {
    if (this.onend) {
      this.onend()
    }
  })

  constructor() {
    instances.push(this)
  }
}

const dispatched: Array<{ type: string; detail: any }> = []

const result = (transcript: string, isFinal: boolean, resultIndex = 0) => ({
  resultIndex,
  results: [{ 0: { transcript }, isFinal }],
})

/** A result list holding several phrases at once, as a continuous session builds. */
const resultList = (phrases: Array<[string, boolean]>, resultIndex = 0) => ({
  resultIndex,
  results: phrases.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })),
})

const setupWindow = (options: { supported?: boolean; hidden?: boolean } = {}) => {
  instances.length = 0
  dispatched.length = 0
  nextStartThrows = false
  const win: any = {
    document: { documentElement: { lang: 'en-GB' }, hidden: options.hidden === true },
    dispatchEvent: (event: any) => {
      dispatched.push({ type: event.type, detail: event.detail })
      return true
    },
  }
  if (options.supported !== false) {
    win.webkitSpeechRecognition = FakeSpeechRecognition
  }
  ;(globalThis as any).window = win
  ;(globalThis as any).CustomEvent = class {
    type: string
    detail: any
    constructor(type: string, init?: { detail?: any }) {
      this.type = type
      this.detail = init ? init.detail : undefined
    }
  }
  return win
}

const baseConfig = {
  sessionId: 'chat',
  resultEventName: 'dictation-result',
  endEventName: 'dictation-ended',
}

const results = () => dispatched.filter((e) => e.type === 'workflow:custom:dictation-result')
const ends = () => dispatched.filter((e) => e.type === 'workflow:custom:dictation-ended')

describe('browser-speech-recognition', () => {
  let handler: Handler

  beforeEach(() => {
    jest.useFakeTimers()
    handler = loadHandler()
    setupWindow()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete (globalThis as any).window
    delete (globalThis as any).CustomEvent
  })

  it('starts a session and reports that it is listening', async () => {
    const out = await handler({ ...baseConfig, action: 'start' }, {})
    expect(out).toMatchObject({ listening: true, supported: true, action: 'started' })
    expect(instances).toHaveLength(1)
    expect(instances[0].start).toHaveBeenCalled()
  })

  it('falls back to the document language when none is configured', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    expect(instances[0].lang).toBe('en-GB')
  })

  it('prefers an explicit language over the document one', async () => {
    await handler({ ...baseConfig, action: 'start', language: 'fr-FR' }, {})
    expect(instances[0].lang).toBe('fr-FR')
  })

  it('toggles off a live session instead of starting a second recogniser', async () => {
    await handler({ ...baseConfig, action: 'toggle' }, {})
    const out = await handler({ ...baseConfig, action: 'toggle' }, {})
    expect(out).toMatchObject({ listening: false, action: 'stopped' })
    expect(instances).toHaveLength(1)
    expect(instances[0].stop).toHaveBeenCalled()
  })

  it('appends the transcript to the text already in the field', async () => {
    await handler({ ...baseConfig, action: 'start', initialText: 'Hello' }, {})
    instances[0].onresult!(result('there', true))
    expect(results()[0].detail.text).toBe('Hello there')
    expect(results()[0].detail.transcript).toBe('there')
  })

  it('emits the transcript alone when the field was empty', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(result('just this', true))
    expect(results()[0].detail.text).toBe('just this')
  })

  it('marks interim results as not final and finals as final', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(result('partial', false))
    instances[0].onresult!(result('complete', true))
    expect(results()[0].detail.isFinal).toBe(false)
    expect(results()[1].detail.isFinal).toBe(true)
  })

  it('does not re-emit an unchanged interim result', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(result('same', false))
    instances[0].onresult!(result('same', false))
    instances[0].onresult!(result('same', false))
    expect(results()).toHaveLength(1)
  })

  it('accumulates finals across a restart, which reports its own results from 0', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(result('first phrase', true))
    // The browser ended the session on silence; auto-restart reuses the same
    // recogniser, whose next result set starts at index 0 again.
    instances[0].onend!()
    instances[0].onresult!(result('second phrase', true))
    expect(results().pop()!.detail.text).toBe('first phrase second phrase')
  })

  it('does not repeat a phrase the engine re-reports as already final', async () => {
    // Chrome re-sends a settled result when a later phrase revises the list.
    // Appending from `event.resultIndex` would say the first phrase twice.
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(resultList([['one', true]]))
    instances[0].onresult!(
      resultList([
        ['one', true],
        ['two', true],
      ])
    )
    expect(results().pop()!.detail.text).toBe('one two')
  })

  it('replaces an interim phrase with its final form rather than keeping both', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(resultList([['hello wor', false]]))
    instances[0].onresult!(resultList([['hello world', true]]))
    expect(results().pop()!.detail.text).toBe('hello world')
  })

  it('shows finals and the live interim together', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onresult!(
      resultList([
        ['first', true],
        ['sec', false],
      ])
    )
    expect(results().pop()!.detail.text).toBe('first sec')
  })

  it('carries the running text on the end event too', async () => {
    await handler({ ...baseConfig, action: 'start', initialText: 'Note:' }, {})
    instances[0].onresult!(result('buy milk', true))
    await handler({ ...baseConfig, action: 'stop' }, {})
    expect(ends()[0].detail.text).toBe('Note: buy milk')
    expect(ends()[0].detail.transcript).toBe('buy milk')
  })

  it('does not blame a mid-session "no-speech" for the eventual end', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onerror!({ error: 'no-speech' })
    instances[0].onend!() // auto-restart clears the transient error
    await handler({ ...baseConfig, action: 'stop' }, {})
    expect(ends()[0].detail.error).toBe('')
    expect(ends()[0].detail.reason).toBe('stopped')
  })

  it('reports an unsupported browser and still emits the end event', async () => {
    setupWindow({ supported: false })
    const out = await handler({ ...baseConfig, action: 'start' }, {})
    expect(out).toMatchObject({ listening: false, supported: false, reason: 'unsupported' })
    expect(ends()).toHaveLength(1)
    expect(ends()[0].detail.reason).toBe('unsupported')
  })

  it('emits exactly one end event with reason "stopped" when the visitor stops it', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    await handler({ ...baseConfig, action: 'stop' }, {})
    expect(ends()).toHaveLength(1)
    expect(ends()[0].detail.reason).toBe('stopped')
  })

  it('surfaces a denied microphone as the end reason', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].onerror!({ error: 'not-allowed' })
    instances[0].onend!()
    expect(ends()).toHaveLength(1)
    expect(ends()[0].detail.reason).toBe('not-allowed')
  })

  it('does not restart after a fatal error', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].start.mockClear()
    instances[0].onerror!({ error: 'not-allowed' })
    instances[0].onend!()
    expect(instances[0].start).not.toHaveBeenCalled()
  })

  it('restarts after an ordinary silence timeout so long dictation is not cut short', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].start.mockClear()
    instances[0].onend!()
    expect(instances[0].start).toHaveBeenCalledTimes(1)
    expect(ends()).toHaveLength(0)
  })

  it('treats "no-speech" as ordinary and keeps listening', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].start.mockClear()
    instances[0].onerror!({ error: 'no-speech' })
    instances[0].onend!()
    expect(instances[0].start).toHaveBeenCalledTimes(1)
  })

  it('does not restart while the tab is in the background', async () => {
    const win = setupWindow()
    await handler({ ...baseConfig, action: 'start' }, {})
    instances[0].start.mockClear()
    win.document.hidden = true
    instances[0].onend!()
    expect(instances[0].start).not.toHaveBeenCalled()
    expect(ends()).toHaveLength(1)
  })

  it('does not restart when auto-restart is off', async () => {
    await handler({ ...baseConfig, action: 'start', autoRestart: false }, {})
    instances[0].start.mockClear()
    instances[0].onend!()
    expect(instances[0].start).not.toHaveBeenCalled()
    expect(ends()[0].detail.reason).toBe('ended')
  })

  it('stops on its own after the maximum duration', async () => {
    await handler({ ...baseConfig, action: 'start', maxDurationMs: 1000 }, {})
    jest.advanceTimersByTime(1001)
    expect(instances[0].stop).toHaveBeenCalled()
    expect(ends()).toHaveLength(1)
    expect(ends()[0].detail.reason).toBe('timeout')
  })

  it('leaves a live session alone when told to start again', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    const out = await handler({ ...baseConfig, action: 'start' }, {})
    expect(out).toMatchObject({ listening: true, action: 'unchanged' })
    expect(instances).toHaveLength(1)
  })

  it('is a no-op when told to stop a session that is not running', async () => {
    const out = await handler({ ...baseConfig, action: 'stop' }, {})
    expect(out).toMatchObject({ listening: false, action: 'unchanged' })
    expect(ends()).toHaveLength(0)
  })

  it('finalizes rather than stranding the caller when start() throws', async () => {
    await handler({ ...baseConfig, action: 'start' }, {})
    await handler({ ...baseConfig, action: 'stop' }, {})
    dispatched.length = 0
    nextStartThrows = true
    const out = await handler({ ...baseConfig, action: 'start' }, {})
    expect(out).toMatchObject({ listening: false, reason: 'start-failed' })
    expect(ends()).toHaveLength(1)
    expect(ends()[0].detail.reason).toBe('start-failed')
  })

  it('gives up rather than restarting a recogniser that fails instantly', async () => {
    // No microphone, or the speech service unreachable: every run ends at once.
    // Restarting those as fast as the browser allows is a tight loop.
    await handler({ ...baseConfig, action: 'start' }, {})
    for (let i = 0; i < 20; i += 1) {
      instances[0].onend!()
    }
    expect(instances[0].start.mock.calls.length).toBeLessThanOrEqual(6)
    expect(ends()).toHaveLength(1)
  })

  it('keeps restarting when each run actually listened for a while', async () => {
    const realNow = Date.now
    let clock = 0
    Date.now = () => clock
    try {
      await handler({ ...baseConfig, action: 'start' }, {})
      instances[0].start.mockClear()
      for (let i = 0; i < 8; i += 1) {
        clock += 5000 // five seconds of listening before each end
        instances[0].onend!()
      }
      expect(instances[0].start).toHaveBeenCalledTimes(8)
      expect(ends()).toHaveLength(0)
    } finally {
      Date.now = realNow
    }
  })

  it('does not let a replaced session turn the UI off under the new one', async () => {
    // `onend` arrives a task after `.stop()`, so a click landing in that gap
    // starts a fresh session under the same name. The old one must die quietly.
    await handler({ ...baseConfig, action: 'start' }, {})
    const first = instances[0]
    first.stop.mockImplementation(() => {}) // onend deferred, as in a real browser
    await handler({ ...baseConfig, action: 'stop' }, {})
    dispatched.length = 0

    const restarted = await handler({ ...baseConfig, action: 'start' }, {})
    expect(restarted).toMatchObject({ listening: true })
    first.onend!() // the OLD recogniser finally reports back

    expect(ends()).toHaveLength(0)
    expect(Object.keys((globalThis as any).window.__teleportSpeechSessions)).toEqual(['chat'])
  })

  it('keeps separate sessions independent', async () => {
    await handler({ ...baseConfig, sessionId: 'a', action: 'start' }, {})
    await handler({ ...baseConfig, sessionId: 'b', action: 'start' }, {})
    const out = await handler({ ...baseConfig, sessionId: 'a', action: 'stop' }, {})
    expect(out.sessionId).toBe('a')
    expect(instances).toHaveLength(2)
    expect(instances[0].stop).toHaveBeenCalled()
    expect(instances[1].stop).not.toHaveBeenCalled()
  })

  it('emits nothing when no event names are configured', async () => {
    await handler({ action: 'start' }, {})
    instances[0].onresult!(result('quiet', true))
    await handler({ action: 'stop' }, {})
    expect(dispatched).toHaveLength(0)
  })

  it('is registered as a client-only node', () => {
    expect(nodeRegistry['browser-speech-recognition'].executionEnv).toBe('client')
  })

  /**
   * ⛔ `isFatalNodeResult` in the generated runtime treats `success === false`
   * OR any non-empty `error` string as a FAILED node and abandons the rest of
   * the workflow. For this node that would skip the state write that puts the
   * button back to idle — leaving a control stuck showing "recording" precisely
   * in the cases where nothing is being recorded.
   *
   * Not being able to listen is a normal outcome of asking, so no exit path may
   * report one.
   */
  describe('never reports a workflow failure', () => {
    const isFatalNodeResult = (out: any) =>
      !!out &&
      (out.success === false || (typeof out.error === 'string' && out.error) || out.error === true)

    it('on an unsupported browser', async () => {
      setupWindow({ supported: false })
      expect(isFatalNodeResult(await handler({ ...baseConfig, action: 'start' }, {}))).toBe(false)
    })

    it('when start() throws', async () => {
      await handler({ ...baseConfig, action: 'start' }, {})
      await handler({ ...baseConfig, action: 'stop' }, {})
      nextStartThrows = true
      expect(isFatalNodeResult(await handler({ ...baseConfig, action: 'start' }, {}))).toBe(false)
    })

    it('on every ordinary path', async () => {
      const outs = [
        await handler({ ...baseConfig, action: 'stop' }, {}), // nothing running
        await handler({ ...baseConfig, action: 'start' }, {}),
        await handler({ ...baseConfig, action: 'start' }, {}), // already running
        await handler({ ...baseConfig, action: 'stop' }, {}),
      ]
      outs.forEach((out) => expect(isFatalNodeResult(out)).toBe(false))
    })

    it('outside a browser', async () => {
      delete (globalThis as any).window
      expect(isFatalNodeResult(await handler({ ...baseConfig, action: 'start' }, {}))).toBe(false)
    })
  })

  // A consumer that only acts on SETTLED speech — a spoken command, a submit —
  // has nothing to act on unless the final result actually reaches it.
  describe('the final result is never swallowed by the interim before it', () => {
    it('emits the final even when its text is identical to the last interim', async () => {
      await handler({ ...baseConfig, action: 'start' }, {})
      instances[0].onresult!(result('send it', false))
      instances[0].onresult!(result('send it', true))

      expect(results().map((e) => [e.detail.text, e.detail.isFinal])).toEqual([
        ['send it', false],
        ['send it', true],
      ])
    })

    it('still collapses an unchanged interim, which the API repeats several times a second', async () => {
      await handler({ ...baseConfig, action: 'start' }, {})
      instances[0].onresult!(result('hello', false))
      instances[0].onresult!(result('hello', false))
      instances[0].onresult!(result('hello', false))

      expect(results()).toHaveLength(1)
    })
  })

  describe('stopReason', () => {
    it('reports the caller’s reason on the end event', async () => {
      await handler({ ...baseConfig, action: 'start' }, {})
      const out = await handler({ ...baseConfig, action: 'stop', stopReason: 'voice-submit' }, {})

      expect(out).toMatchObject({ listening: false, action: 'stopped' })
      expect(ends()).toHaveLength(1)
      expect(ends()[0].detail.reason).toBe('voice-submit')
    })

    it('falls back to "stopped" when none is given', async () => {
      await handler({ ...baseConfig, action: 'start' }, {})
      await handler({ ...baseConfig, action: 'stop' }, {})

      expect(ends()[0].detail.reason).toBe('stopped')
    })

    it('reports it even when stop() throws and the handler has to finalize itself', async () => {
      await handler({ ...baseConfig, action: 'start' }, {})
      instances[0].stop.mockImplementationOnce(() => {
        throw new Error('InvalidStateError')
      })
      await handler({ ...baseConfig, action: 'stop', stopReason: 'voice-stop' }, {})

      expect(ends()).toHaveLength(1)
      expect(ends()[0].detail.reason).toBe('voice-stop')
    })

    it('leaves a reason the session ended on its own alone', async () => {
      await handler(
        { ...baseConfig, action: 'start', autoRestart: false, stopReason: 'ignored' },
        {}
      )
      instances[0].onend!()

      expect(ends()[0].detail.reason).toBe('ended')
    })
  })

  // Hands-free commands. The visitor dictating has no free hand for a button,
  // so the last thing they say can be the instruction — and the words they said
  // to command must never end up in the field they were dictating into.
  describe('spoken commands', () => {
    // ⛔ Half of a cross-repo contract: the builder declares these same two
    // strings as SPEECH_STOP_PHRASE_REASON / SPEECH_SUBMIT_PHRASE_REASON and
    // gates its "now send the message" branch on them. Neither repo can import
    // the other, so each pins the literal and a one-sided rename fails here.
    it('reports the reason strings the builder gates its branches on', async () => {
      await handler(
        { ...baseConfig, action: 'start', autoRestart: false, stopPhrases: ['stop'] },
        {}
      )
      instances[0].onresult!(result('that is all stop', true))
      expect(ends()[0].detail.reason).toBe('stop-phrase')

      setupWindow()
      await handler(
        { ...baseConfig, action: 'start', autoRestart: false, submitPhrases: ['send it'] },
        {}
      )
      instances[0].onresult!(result('a question send it', true))
      expect(ends()[0].detail.reason).toBe('submit-phrase')
    })

    const phraseConfig = {
      ...baseConfig,
      action: 'start',
      autoRestart: false,
      stopPhrases: ['stop listening', 'stop'],
      submitPhrases: ['send the message', 'send it', 'send'],
    }

    it('stops the session when a stop phrase ends a settled result', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('remind me to call the vet stop listening', true))

      expect(instances[0].stop).toHaveBeenCalled()
      expect(ends()).toHaveLength(1)
      expect(ends()[0].detail.reason).toBe('stop-phrase')
      expect(ends()[0].detail.matchedPhrase).toBe('stop listening')
    })

    it('reports the submit reason for a send phrase, so a workflow can act', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('what are your opening hours send it', true))

      expect(ends()[0].detail.reason).toBe('submit-phrase')
      expect(ends()[0].detail.matchedPhrase).toBe('send it')
    })

    it('cuts the command out of every emitted text, end event included', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('what are your opening hours send it', true))

      expect(results()[results().length - 1].detail.text).toBe('what are your opening hours')
      expect(ends()[0].detail.text).toBe('what are your opening hours')
    })

    it('hides the command word on an interim WITHOUT acting on it', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('what are your opening hours send it', false))

      expect(results()[0].detail.text).toBe('what are your opening hours')
      expect(instances[0].stop).not.toHaveBeenCalled()
      expect(ends()).toHaveLength(0)
    })

    it('prefers the longest phrase, so a shorter one cannot strand words', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('book me a table stop listening', true))

      expect(ends()[0].detail.text).toBe('book me a table')
    })

    it('only matches at a word boundary and only at the end', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('please tell me what to enclose', true))
      instances[0].onresult!(result('how do I stop my subscription', true))

      expect(instances[0].stop).not.toHaveBeenCalled()
      expect(ends()).toHaveLength(0)
    })

    it('treats a submit that leaves nothing behind as a plain stop', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('send it', true))

      expect(ends()[0].detail.reason).toBe('stop-phrase')
      expect(ends()[0].detail.text).toBe('')
    })

    it('keeps the message’s own punctuation, dropping only the separator', async () => {
      await handler(phraseConfig, {})
      instances[0].onresult!(result('what time do you open? send it.', true))

      expect(ends()[0].detail.text).toBe('what time do you open?')
    })

    it('does nothing at all when no phrases are configured', async () => {
      await handler({ ...baseConfig, action: 'start', autoRestart: false }, {})
      instances[0].onresult!(result('please send it', true))

      expect(instances[0].stop).not.toHaveBeenCalled()
      expect(results()[0].detail.text).toBe('please send it')
    })

    it('appends to text already in the field without matching against it', async () => {
      await handler({ ...phraseConfig, initialText: 'draft: send' }, {})
      instances[0].onresult!(result('and the rest send it', true))

      // The typed "send" is not a command — only what was SPOKEN is matched.
      expect(ends()[0].detail.text).toBe('draft: send and the rest')
    })
  })
})
