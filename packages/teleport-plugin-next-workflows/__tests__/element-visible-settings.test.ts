// The "On Visible" trigger's settings, as the editor's inspector writes them:
// a PERCENT threshold and `once` (formerly `triggerOnce`). Before 2026-09-18 the
// percent reached IntersectionObserver unconverted — Chrome 153: "RangeError:
// Failed to construct 'IntersectionObserver': Threshold values must be numbers
// between 0 and 1" — and "run once" was never read.

import { elementVisibleObserverCode, elementVisibleSettings } from '../src/element-visible-trigger'
import { generateTriggerCode } from '../src/trigger-generator'

describe('elementVisibleSettings', () => {
  it('turns the inspector percent into the share the browser counts, within 0–1', () => {
    expect(elementVisibleSettings({ threshold: 50 }).threshold).toBe(0.5)
    expect(elementVisibleSettings({ threshold: 100 }).threshold).toBe(1)
    expect(elementVisibleSettings({ threshold: 250 }).threshold).toBe(1)
    expect(elementVisibleSettings({ threshold: -5 }).threshold).toBe(0)
    expect(elementVisibleSettings({}).threshold).toBe(0)
    expect(elementVisibleSettings({ threshold: 'x' }).threshold).toBe(0)
  })

  it('runs once unless told otherwise, and still reads the name older projects saved', () => {
    expect(elementVisibleSettings({}).once).toBe(true)
    expect(elementVisibleSettings({ once: false }).once).toBe(false)
    expect(elementVisibleSettings({ triggerOnce: false }).once).toBe(false)
    expect(elementVisibleSettings({ triggerOnce: true }).once).toBe(true)
    // the current name wins when both are present
    expect(elementVisibleSettings({ once: true, triggerOnce: false }).once).toBe(true)
  })
})

/**
 * Runs the generated statements against a fake IntersectionObserver and lets a
 * test feed it the entries a browser would, one visibility change at a time.
 */
const observe = (config: Record<string, unknown>, viewportHeight = 1000) => {
  let callback: (entries: unknown[]) => void = () => undefined
  let options: { threshold: number | number[] } = { threshold: 0 }
  let disconnected = false
  class FakeObserver {
    constructor(cb: (entries: unknown[]) => void, opts: { threshold: number | number[] }) {
      callback = cb
      options = opts
    }
    disconnect() {
      disconnected = true
    }
  }
  const runs: number[] = []
  const code = elementVisibleObserverCode('obs', config, 'runs.push(entry.intersectionRatio);')
  // tslint:disable-next-line:function-constructor
  new Function('IntersectionObserver', 'window', 'runs', code)(
    FakeObserver,
    { innerHeight: viewportHeight },
    runs
  )
  const see = (ratio: number, height = 400) => {
    if (!disconnected) {
      callback([
        { isIntersecting: ratio > 0, intersectionRatio: ratio, boundingClientRect: { height } },
      ])
    }
  }
  return { runs, see, options: () => options, disconnected: () => disconnected }
}

describe('the generated observer', () => {
  it('builds a valid observer for a threshold typed in the inspector', () => {
    const { options } = observe({ threshold: 50 })
    const thresholds = ([] as number[]).concat(options().threshold)
    expect(thresholds.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  it('runs when enough of the element is on screen, once by default', () => {
    const trigger = observe({ threshold: 50 })
    trigger.see(0.3)
    expect(trigger.runs).toEqual([])
    trigger.see(0.55)
    expect(trigger.runs).toEqual([0.55])
    expect(trigger.disconnected()).toBe(true)
    trigger.see(0.1)
    trigger.see(0.9)
    expect(trigger.runs).toEqual([0.55])
  })

  it('"every time" runs again after the element has left, never twice while it stays', () => {
    const trigger = observe({ threshold: 50, triggerOnce: false })
    trigger.see(0.6)
    trigger.see(0.8)
    trigger.see(0.65)
    expect(trigger.runs).toEqual([0.6])
    trigger.see(0.2)
    trigger.see(0.7)
    expect(trigger.runs).toEqual([0.6, 0.7])
    expect(trigger.disconnected()).toBe(false)
  })

  it('an element taller than the screen runs at what it can reach', () => {
    // 3000px tall in a 1000px screen: at most a third of it is ever visible
    const trigger = observe({ threshold: 60 }, 1000)
    trigger.see(0.32, 3000)
    expect(trigger.runs).toEqual([0.32])
  })

  it('with no threshold it runs as soon as any part appears', () => {
    const trigger = observe({})
    expect(trigger.options().threshold).toBe(0)
    trigger.see(0.01)
    expect(trigger.runs).toEqual([0.01])
  })
})

describe('both generator paths use it', () => {
  it('the exported trigger generator no longer passes the percent to the browser', () => {
    const code = generateTriggerCode(
      {
        id: 'wf-1',
        trigger: {
          type: 'event-element-visible',
          config: { elementHtmlId: 'hero', threshold: 50, triggerOnce: false },
        },
      } as never,
      'wf'
    )
    expect(code).not.toContain('threshold: 50')
    expect(code).toContain('Math.min(0.5, reach * 0.9)')
    // "every time": the only disconnect left is the cleanup's
    expect(code.match(/disconnect\(\)/g)).toHaveLength(1)
  })
})
