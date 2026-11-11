// A timer with a control event is steered by the "Emit Custom Event" node,
// which dispatches `workflow:custom:<name>`. The timer used to listen for the
// bare name only, so an emitted control event reached nothing; and it could
// only toggle, while workflows emit the event with a "start" or "stop" command.

import type { UIDLWorkflow } from '@teleporthq/teleport-types'
import { generateLifecycleTrigger } from '../src/workflow-component-plugin'
import { generateTriggerCode } from '../src/trigger-generator'

const CONTROL_EVENT = 'rotation-control'
const EMITTED = `workflow:custom:${CONTROL_EVENT}`
const SAFE_ID = 'wf_rotation'

const intervalWorkflow = (config: Record<string, unknown> = {}): UIDLWorkflow =>
  ({
    id: 'wf-rotation',
    name: 'Photo Rotation',
    trigger: {
      type: 'event-interval',
      nodeId: 'trigger-interval',
      scope: 'component',
      config: {
        intervalMs: 1000,
        autoStart: true,
        runWhileHidden: true,
        controlEventName: CONTROL_EVENT,
        componentId: 'TQ_card',
        ...config,
      },
    },
    nodes: [],
    edges: [],
  } as unknown as UIDLWorkflow)

type Listener = (event: { detail?: unknown }) => void

const fakeWindow = () => {
  const listeners: Record<string, Listener[]> = {}
  return {
    listeners,
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = [...(listeners[type] || []), listener]
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners[type] = (listeners[type] || []).filter((registered) => registered !== listener)
    },
    emit: (type: string, detail?: unknown) =>
      (listeners[type] || []).forEach((listener) => listener({ detail })),
    listenerCount: () =>
      Object.keys(listeners).reduce((count, type) => count + listeners[type].length, 0),
  }
}

interface RunningTimer {
  source: string
  window: ReturnType<typeof fakeWindow>
  ticks: () => number
  teardown: () => void
}

/** The timer as a component sets it up in its effect. */
const inComponent = (config: Record<string, unknown> = {}): RunningTimer => {
  const window = fakeWindow()
  const cleanups: Array<() => void> = []
  let ticks = 0
  const source = generateLifecycleTrigger(intervalWorkflow(config), SAFE_ID)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    'window',
    'document',
    'cleanups',
    '__execWf',
    `__wfConfig_${SAFE_ID}`,
    `__wfServerUrls_${SAFE_ID}`,
    source
  )(window, {}, cleanups, () => ticks++, {}, {})
  return {
    source,
    window,
    ticks: () => ticks,
    teardown: () => cleanups.forEach((cleanup) => cleanup()),
  }
}

/** The same timer in its native-listener form, whose statements return the teardown. */
const asNativeTrigger = (config: Record<string, unknown> = {}): RunningTimer => {
  const window = fakeWindow()
  let ticks = 0
  const source = generateTriggerCode(intervalWorkflow(config), 'runWorkflow')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const teardown = new Function('window', 'document', 'runWorkflow', source)(
    window,
    {},
    () => ticks++
  )
  return { source, window, ticks: () => ticks, teardown }
}

describe.each([
  ['in a component', inComponent],
  ['as a native trigger', asNativeTrigger],
])('a timer with a control event, %s', (_name, start) => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('hears the event the emit node dispatches, and the bare name', () => {
    const timer = start()

    expect(Object.keys(timer.window.listeners).sort()).toEqual([CONTROL_EVENT, EMITTED].sort())
    expect(timer.source).toContain(`window.addEventListener("${EMITTED}", `)
    timer.teardown()
  })

  it('stops ticking on "stop" and resumes on "start"', () => {
    const timer = start()
    jest.advanceTimersByTime(3000)
    expect(timer.ticks()).toBe(3)

    timer.window.emit(EMITTED, 'stop')
    jest.advanceTimersByTime(3000)
    expect(timer.ticks()).toBe(3)

    timer.window.emit(EMITTED, 'start')
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(5)
    timer.teardown()
  })

  it('"start" while running, twice over, leaves one timer; "stop" while stopped stays stopped', () => {
    const timer = start()
    timer.window.emit(EMITTED, 'start')
    timer.window.emit(EMITTED, 'start')
    jest.advanceTimersByTime(3000)
    expect(timer.ticks()).toBe(3)

    timer.window.emit(EMITTED, 'stop')
    timer.window.emit(EMITTED, 'stop')
    jest.advanceTimersByTime(3000)
    expect(timer.ticks()).toBe(3)
    timer.teardown()
  })

  it.each([
    ['action', { action: 'stop' }, { action: 'start' }],
    ['command', { command: 'stop' }, { command: 'start' }],
  ])('reads the command from an object detail: %s', (_key, stop, resume) => {
    const timer = start({ autoStart: false })
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(0)

    timer.window.emit(EMITTED, resume)
    timer.window.emit(EMITTED, resume)
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(2)

    timer.window.emit(EMITTED, stop)
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(2)
    timer.teardown()
  })

  it.each([
    ['no detail', undefined],
    ['the emit node default, an empty object', {}],
    ['a detail that names no command', { photo: 3 }],
    ['an unknown word', 'pause'],
  ])('toggles on an event with %s', (_case, detail) => {
    const timer = start()

    timer.window.emit(EMITTED, detail)
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(0)

    timer.window.emit(EMITTED, detail)
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(2)
    timer.teardown()
  })

  it('still answers the bare event name, and one dispatch is handled once', () => {
    const timer = start()

    // Handled twice, a toggle would leave the timer running.
    timer.window.emit(CONTROL_EVENT)
    jest.advanceTimersByTime(2000)
    expect(timer.ticks()).toBe(0)

    timer.window.emit(CONTROL_EVENT, 'start')
    jest.advanceTimersByTime(1000)
    expect(timer.ticks()).toBe(1)
    timer.teardown()
  })

  it('teardown removes both listeners and stops the timer for good', () => {
    const timer = start()
    const [emitted] = timer.window.listeners[EMITTED]
    expect(timer.window.listenerCount()).toBe(2)

    timer.teardown()

    expect(timer.window.listenerCount()).toBe(0)
    jest.advanceTimersByTime(3000)
    expect(timer.ticks()).toBe(0)
    // A late event, delivered to the handler it once had, starts nothing.
    emitted({ detail: 'start' })
    jest.advanceTimersByTime(3000)
    expect(timer.ticks()).toBe(0)
  })

  it('a timer without a control event listens for nothing', () => {
    const timer = start({ controlEventName: undefined })

    expect(timer.window.listenerCount()).toBe(0)
    expect(timer.source).not.toContain('__iv_ctrlHandler_')
    timer.teardown()
  })
})
