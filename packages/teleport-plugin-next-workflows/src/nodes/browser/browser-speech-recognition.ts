import { NodeHandlerGenerator, handlerToString } from '../types'

/**
 * A long-lived dictation session, as opposed to `browser-speech-to-text`, which
 * awaits the FIRST phrase, resolves, and offers no way to stop.
 *
 * The contract this node exists for:
 *
 *  - It RETURNS IMMEDIATELY. A workflow that awaited the transcript could not
 *    also run a second workflow to stop the microphone, and the node would hold
 *    the whole run open for as long as the visitor kept talking.
 *  - Transcripts leave through CUSTOM EVENTS (`resultEventName`), dispatched on
 *    the `workflow:custom:` channel that `event-custom-triggered` listens on. A
 *    workflow bound to that event writes the text into a field, so every
 *    app-visible effect still belongs to a workflow rather than to this handler.
 *  - The session registry on `window` — not a page state — is the authority on
 *    whether the microphone is live, so `action: "toggle"` cannot desync from
 *    reality no matter how the UI state was left.
 *
 * Every exit path ends in exactly one `endEventName` dispatch, including the
 * ones that never started (unsupported browser, `start()` throwing), so the UI
 * that turned "listening" on always has something to turn it off again.
 *
 * ⛔ NOTHING here is reported as an `error`. The runtime's `isFatalNodeResult`
 * treats any non-empty `error` string as a FAILED node and aborts the rest of
 * the workflow — which would skip the very state write that puts the button
 * back to idle, and would fire the error branch of any workflow that has one.
 * A browser without the API, or a visitor who declines the microphone, is a
 * normal outcome of asking, not a failure of the workflow, so it comes back as
 * `reason` and the caller decides what to say about it.
 */
async function browser_speech_recognition(config: any, _context: Record<string, unknown>) {
  const REGISTRY_KEY = '__teleportSpeechSessions'
  const DEFAULT_MAX_DURATION_MS = 120000
  // Chrome ends a "continuous" session after a few seconds of silence, so a
  // dictation of any length is really a chain of restarts. The cap is what
  // stops a microphone that can never hear anything (muted device, wrong input)
  // from restarting forever.
  const MAX_CONSECUTIVE_RESTARTS = 60
  // A run shorter than this heard nothing at all; see `onend`.
  const MIN_USEFUL_RUN_MS = 500
  const MAX_RAPID_RESTARTS = 5
  // Errors that mean "this will not work, stop trying" rather than "nothing was
  // said just now". `no-speech` and `aborted` are ordinary and must NOT be here.
  const FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture', 'bad-grammar']
  // ⛔ These two strings are a CONTRACT with the builder repo, where they are
  // `SPEECH_STOP_PHRASE_REASON` / `SPEECH_SUBMIT_PHRASE_REASON` and are what a
  // workflow gates its follow-up branch on. The handler is emitted as a
  // standalone string in a separate repo, so it cannot import them: instead
  // both sides pin the literal in their own tests, and either one changing the
  // spelling alone fails there.
  const STOP_PHRASE_REASON = 'stop-phrase'
  const SUBMIT_PHRASE_REASON = 'submit-phrase'

  const win: any = typeof window === 'undefined' ? null : window
  if (!win) {
    return {
      listening: false,
      supported: false,
      action: 'unchanged',
      sessionId: '',
      reason: 'no-window',
    }
  }

  const sessions = win[REGISTRY_KEY] || (win[REGISTRY_KEY] = {})
  const sessionId = String(
    config.sessionId == null || config.sessionId === '' ? 'default' : config.sessionId
  )
  const requested = config.action === 'start' || config.action === 'stop' ? config.action : 'toggle'
  const resultEventName = typeof config.resultEventName === 'string' ? config.resultEventName : ''
  const endEventName = typeof config.endEventName === 'string' ? config.endEventName : ''
  // What the end event reports when THIS call is the thing that stops the
  // session. A caller that stops for a reason of its own — a spoken "send that",
  // a navigation, a closing panel — needs the end workflow to be able to tell
  // that apart from the visitor clicking the microphone off, and the end event
  // is the only place both arrive.
  const stopReason =
    typeof config.stopReason === 'string' && config.stopReason ? config.stopReason : 'stopped'

  const dispatch = (eventName: string, detail: any) => {
    if (!eventName) {
      return
    }
    try {
      win.dispatchEvent(new CustomEvent('workflow:custom:' + eventName, { detail }))
    } catch (e) {
      /* a listener throwing must never take the session down with it */
    }
  }

  const existing = sessions[sessionId]
  const isListening = !!(existing && existing.active)

  // ── stop ──────────────────────────────────────────────────────────────────
  if (requested === 'stop' || (requested === 'toggle' && isListening)) {
    if (!existing) {
      return {
        listening: false,
        supported: true,
        action: 'unchanged',
        sessionId,
        reason: '',
      }
    }
    // Cleared BEFORE `.stop()` so the `onend` that follows finalizes instead of
    // auto-restarting, and so a second click cannot stop the same session twice.
    existing.active = false
    existing.reason = stopReason
    try {
      existing.recognition.stop()
    } catch (e) {
      // Already stopping, or never started. `onend` may therefore never fire,
      // so finalize here instead of leaving the UI stuck on "listening".
      if (existing.finalize) {
        existing.finalize(stopReason, '')
      }
    }
    return {
      listening: false,
      supported: true,
      action: 'stopped',
      sessionId,
      reason: '',
    }
  }

  // ── start ─────────────────────────────────────────────────────────────────
  if (isListening) {
    // `action: "start"` on a live session: leave it alone rather than replacing
    // the recogniser, which would drop everything said so far.
    return {
      listening: true,
      supported: true,
      action: 'unchanged',
      sessionId,
      reason: '',
    }
  }

  const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition
  if (!SpeechRecognition) {
    // Firefox, and every browser with the API behind a flag. The end event is
    // still emitted so the caller's "listening" state is turned back off and it
    // has a `reason` to explain the failure with.
    dispatch(endEventName, {
      sessionId,
      text: typeof config.initialText === 'string' ? config.initialText : '',
      transcript: '',
      reason: 'unsupported',
      error: '',
      listening: false,
    })
    return {
      listening: false,
      supported: false,
      action: 'unchanged',
      sessionId,
      reason: 'unsupported',
    }
  }

  const baseText = typeof config.initialText === 'string' ? config.initialText : ''
  const continuous = config.continuous !== false
  const interimResults = config.interimResults !== false
  const language =
    (typeof config.language === 'string' && config.language) ||
    (win.document && win.document.documentElement && win.document.documentElement.lang) ||
    'en-US'
  const autoRestart = config.autoRestart !== false && continuous
  // Spoken commands. Normalised once, longest first: "stop listening" has to
  // win over "stop", or the longer spelling leaves "listening" in the field.
  const toPhraseList = (value: any) =>
    (Array.isArray(value) ? value : [])
      .map((entry: any) =>
        String(entry == null ? '' : entry)
          .toLowerCase()
          .trim()
      )
      .filter(function (entry: string) {
        return entry !== ''
      })
      .sort(function (a: string, b: string) {
        return b.length - a.length
      })
  const stopPhrases = toPhraseList(config.stopPhrases)
  const submitPhrases = toPhraseList(config.submitPhrases)
  const maxDurationMs =
    typeof config.maxDurationMs === 'number' && config.maxDurationMs > 0
      ? config.maxDurationMs
      : DEFAULT_MAX_DURATION_MS

  const session: any = {
    active: true,
    startedAt: 0,
    rapidRestarts: 0,
    baseText,
    // Finals from recogniser runs that have already ended. Kept apart from the
    // current run's finals because a restarted recogniser reports its own
    // results from index 0 again, so the two cannot share one accumulator.
    committedText: '',
    currentFinalText: '',
    lastEmitted: null,
    restarts: 0,
    reason: 'ended',
    matchedPhrase: '',
    error: '',
    finished: false,
    recognition: null,
    timer: null,
    finalize: null,
  }
  sessions[sessionId] = session

  // Every seam between two pieces of text needs the same rule: without it,
  // "hello" typed then "there" spoken comes back as "hellothere".
  const join = (head: string, tail: string) => {
    if (!head) {
      return tail
    }
    if (!tail) {
      return head
    }
    return /\s$/.test(head) ? head + tail : head + ' ' + tail
  }

  /** Everything recognised so far in this session, across restarts. */
  const spokenSoFar = () => join(session.committedText, session.currentFinalText)

  /** What the target field should now contain. */
  const compose = (spoken: string) => join(session.baseText, spoken)

  // ── spoken commands ───────────────────────────────────────────────────────
  // A command is the LAST thing said, so matching is anchored to the end of the
  // text and to a word boundary — "enclose" is not "close", and "how do I
  // submit a return" is not a submit. Trailing punctuation is the recogniser's,
  // never the visitor's: "send it." and "send it" are one instruction.
  const trimCommandTail = (value: string) => value.replace(/[\s.,!?;:]+$/, '')
  // ⛔ The MESSAGE keeps its own punctuation. Only the separator between it and
  // the command goes — the pause comma the recogniser writes for "what time do
  // you open, send it". Trimming the same set would turn a dictated question
  // into a statement.
  const trimSeparator = (value: string) => value.replace(/[\s,;:]+$/, '')

  const matchPhraseAtEnd = (text: string, phrases: string[]) => {
    const trimmed = trimCommandTail(text)
    const lower = trimmed.toLowerCase()
    for (let i = 0; i < phrases.length; i += 1) {
      const phrase = phrases[i]
      if (!phrase || lower.length < phrase.length) {
        continue
      }
      if (lower.slice(lower.length - phrase.length) !== phrase) {
        continue
      }
      const head = trimmed.slice(0, trimmed.length - phrase.length)
      if (head !== '' && !/\s$/.test(head)) {
        continue
      }
      return { phrase, rest: trimSeparator(head) }
    }
    return null
  }

  /**
   * What the field should show, and what the visitor asked for.
   *
   * Stripping runs on EVERY update so the command word is never visible, and is
   * self-correcting: an interim that revises itself puts the word back on the
   * next one. Only a settled phrase ACTS, which is what stops a half-spoken
   * sentence from firing.
   */
  const readCommand = (text: string, isFinal: boolean) => {
    if (stopPhrases.length === 0 && submitPhrases.length === 0) {
      return { text, action: '', phrase: '' }
    }
    let hit = matchPhraseAtEnd(text, submitPhrases)
    let action = hit ? 'submit' : ''
    if (!hit) {
      hit = matchPhraseAtEnd(text, stopPhrases)
      action = hit ? 'stop' : ''
    }
    if (!hit) {
      return { text, action: '', phrase: '' }
    }
    // Nothing left to act on is a plain stop, never an empty submission.
    if (action === 'submit' && hit.rest.trim() === '') {
      action = 'stop'
    }
    return { text: hit.rest, action: isFinal ? action : '', phrase: hit.phrase }
  }

  const finalize = (reason: string, error: string, matchedPhrase?: string) => {
    if (session.finished) {
      return
    }
    session.finished = true
    session.active = false
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    // ⛔ A session that has been REPLACED must die quietly. `onend` arrives a
    // task after `.stop()`, so a click landing in that gap starts a fresh
    // session under the same name — and the old one's end event would then turn
    // the UI off while the new microphone is live.
    const isCurrent = sessions[sessionId] === session
    if (!isCurrent) {
      return
    }
    delete sessions[sessionId]
    // The command word is cut out here too, so the end event's text is the same
    // thing the field was left showing.
    const spoken = readCommand(spokenSoFar(), true)
    dispatch(endEventName, {
      sessionId,
      text: compose(spoken.text),
      transcript: spoken.text,
      reason,
      error,
      matchedPhrase: matchedPhrase || '',
      listening: false,
    })
  }
  session.finalize = finalize

  const recognition = new SpeechRecognition()
  session.recognition = recognition
  recognition.lang = language
  recognition.continuous = continuous
  recognition.interimResults = interimResults
  if (typeof config.maxAlternatives === 'number' && config.maxAlternatives > 0) {
    recognition.maxAlternatives = config.maxAlternatives
  }

  recognition.onresult = (event: any) => {
    // ⛔ REBUILT from the whole result list, never appended from
    // `event.resultIndex`. An engine is free to re-report a result that is
    // already final (Chrome does when a later phrase revises an earlier one),
    // and an append would then say the same sentence twice. Rebuilding is
    // idempotent whatever the engine re-sends.
    let currentFinal = ''
    let interim = ''
    const results = event.results || []
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i]
      const alternative = result && result[0]
      const text =
        alternative && alternative.transcript ? String(alternative.transcript).trim() : ''
      if (result && result.isFinal) {
        currentFinal = join(currentFinal, text)
      } else {
        interim = join(interim, text)
      }
    }
    session.currentFinalText = currentFinal
    const isFinal = !interim
    const spoken = readCommand(join(spokenSoFar(), interim), isFinal)
    const composed = compose(spoken.text)
    // The API re-emits an unchanged interim result several times a second;
    // without this guard each one would run the consuming workflow again.
    //
    // ⛔ Finality is part of the key. The last interim of a phrase almost always
    // has the SAME text as the final that follows it, so keying on the text
    // alone swallowed the final event entirely — and a consumer that only acts
    // on settled speech (a spoken command, a submit) would then never fire.
    const emissionKey = composed + '\u0000' + (isFinal ? '1' : '0')
    if (emissionKey !== session.lastEmitted) {
      session.lastEmitted = emissionKey
      dispatch(resultEventName, {
        sessionId,
        text: composed,
        transcript: spoken.text,
        isFinal,
        listening: true,
      })
    }

    if (!spoken.action) {
      return
    }
    // A spoken command ends the session itself. The result event above went out
    // first and carries the text with the command already cut out, so whatever
    // writes it into the field has the final value before the end event lands.
    session.active = false
    session.reason = spoken.action === 'submit' ? SUBMIT_PHRASE_REASON : STOP_PHRASE_REASON
    session.matchedPhrase = spoken.phrase
    try {
      recognition.stop()
    } catch (e) {
      finalize(session.reason, '', spoken.phrase)
    }
  }

  recognition.onerror = (event: any) => {
    const code = (event && event.error) || 'unknown'
    session.error = code
    if (FATAL_ERRORS.indexOf(code) >= 0) {
      session.active = false
      session.reason = code
    }
  }

  recognition.onend = () => {
    // A run that ended almost as soon as it began never listened to anything —
    // no microphone, or the speech service unreachable. Restarting those as fast
    // as the browser allows is a tight loop, so they get a much shorter leash
    // than the ordinary silence-timeout restarts they are counted apart from.
    const ranFor = Date.now() - session.startedAt
    session.rapidRestarts = ranFor < MIN_USEFUL_RUN_MS ? session.rapidRestarts + 1 : 0

    const canRestart =
      session.active &&
      autoRestart &&
      session.restarts < MAX_CONSECUTIVE_RESTARTS &&
      session.rapidRestarts < MAX_RAPID_RESTARTS &&
      !(win.document && win.document.hidden)
    if (!canRestart) {
      finalize(session.active ? 'ended' : session.reason, session.error, session.matchedPhrase)
      return
    }
    // Bank this run's finals before the recogniser starts numbering from 0
    // again, and drop the error that ended it — `no-speech` from a pause must
    // not be reported as the reason the whole session eventually stopped.
    session.committedText = spokenSoFar()
    session.currentFinalText = ''
    session.error = ''
    session.restarts += 1
    session.startedAt = Date.now()
    try {
      recognition.start()
    } catch (e) {
      finalize('ended', session.error)
    }
  }

  session.startedAt = Date.now()
  try {
    recognition.start()
  } catch (e) {
    // `InvalidStateError` from a recogniser the browser still considers running.
    finalize('start-failed', (e as Error).message || 'start-failed')
    return {
      listening: false,
      supported: true,
      action: 'unchanged',
      sessionId,
      reason: 'start-failed',
    }
  }

  session.timer = setTimeout(() => {
    if (!session.active) {
      return
    }
    session.active = false
    session.reason = 'timeout'
    try {
      recognition.stop()
    } catch (e) {
      finalize('timeout', '')
    }
  }, maxDurationMs)

  return { listening: true, supported: true, action: 'started', sessionId, reason: '' }
}

export const browserSpeechRecognition: NodeHandlerGenerator = {
  nodeType: 'browser-speech-recognition',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_speech_recognition)
  },
}
