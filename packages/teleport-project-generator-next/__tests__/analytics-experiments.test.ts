import {
  buildExperimentAssignmentScript,
  buildExperimentHeadSnippet,
  collectExperimentIds,
} from '../src/analytics/experiments'
import { NextAnalyticsProjectPlugin } from '../src/analytics/project-plugin'

/**
 * A/B tests: the generator finds the experiments by their attributes, and the
 * head script picks ONE arm per visitor before the body is parsed, hides the
 * other, keeps the choice, and publishes it for the tracker.
 */

const element = (attrs: Record<string, string>, children: any[] = []) => ({
  type: 'element',
  content: {
    elementType: 'container',
    attrs: Object.fromEntries(
      Object.entries(attrs).map(([key, value]) => [key, { type: 'static', content: value }])
    ),
    children,
  },
})

const uidlWith = (rootChildren: any[], componentChildren: any[] = []) =>
  ({
    globals: { customCode: { head: '<meta name="x">' } },
    root: { node: element({}, rootChildren) },
    components: componentChildren.length ? { Hero: { node: element({}, componentChildren) } } : {},
  } as any)

function runScript(ids: string[], storage: Record<string, string>, random = 0.2) {
  const styles: string[] = []
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
    },
  } as any
  const fakeDocument = {
    createElement: () => ({ textContent: '' }),
    head: { appendChild: (node: { textContent: string }) => styles.push(node.textContent) },
  }
  new Function('window', 'document', 'Math', buildExperimentAssignmentScript(ids))(
    fakeWindow,
    fakeDocument,
    Object.assign(Object.create(Math), { random: () => random })
  )
  return { assigned: fakeWindow.__tpExp as Record<string, string>, styles }
}

describe('experiments — finding them in the project', () => {
  it('collects the ids from pages and components, once each, sorted', () => {
    const uidl = uidlWith(
      [
        element({ 'data-tq-exp': 'hero-1', 'data-tq-exp-variant': 'a' }),
        element({ 'data-tq-exp': 'hero-1', 'data-tq-exp-variant': 'b' }),
        element({ 'data-tq-exp': 'BAD ID', 'data-tq-exp-variant': 'a' }),
      ],
      [element({ 'data-tq-exp': 'cta-2', 'data-tq-exp-variant': 'a' })]
    )
    expect(collectExperimentIds(uidl)).toEqual(['cta-2', 'hero-1'])
    expect(collectExperimentIds(uidlWith([]))).toEqual([])
  })

  it('puts the assignment script first in the head, only when there are experiments', async () => {
    const plugin = new NextAnalyticsProjectPlugin()
    const uidl = uidlWith([element({ 'data-tq-exp': 'hero-1', 'data-tq-exp-variant': 'a' })])
    await plugin.runBefore({ uidl, files: new Map() } as any)
    expect(uidl.globals.customCode.head.startsWith('<script>')).toBe(true)
    expect(uidl.globals.customCode.head.endsWith('<meta name="x">')).toBe(true)
    expect(uidl.globals.customCode.head).toContain('"hero-1"')

    const plain = uidlWith([])
    await plugin.runBefore({ uidl: plain, files: new Map() } as any)
    expect(plain.globals.customCode.head).toBe('<meta name="x">')
    expect(buildExperimentHeadSnippet([])).toBe('')
  })

  it('stays under a kilobyte for a page with a few experiments', () => {
    expect(buildExperimentAssignmentScript(['hero-1', 'cta-2', 'image-3']).length).toBeLessThan(
      1024
    )
  })
})

describe('experiments — the head script', () => {
  it('flips a coin without consent, keeps the arm, and hides the other variant', () => {
    const storage: Record<string, string> = {}
    const first = runScript(['hero-1'], storage, 0.2)
    expect(first.assigned).toEqual({ 'hero-1': 'a' })
    expect(storage['tq_exp:hero-1']).toBe('a')
    expect(first.styles).toEqual([
      '[data-tq-exp="hero-1"][data-tq-exp-variant="b"],[data-tq-exp="hero-1"][data-tq-exp-variant="b"] *{display:none!important}',
    ])
    // A later visit with a different coin keeps the stored arm.
    const again = runScript(['hero-1'], storage, 0.9)
    expect(again.assigned).toEqual({ 'hero-1': 'a' })

    const other = runScript(['hero-1'], {}, 0.9)
    expect(other.assigned).toEqual({ 'hero-1': 'b' })
    expect(other.styles[0]).toContain('[data-tq-exp-variant="a"]')
  })

  it('derives the arm from the visitor id with consent — stable per visitor, not per site', () => {
    const consented = { cookieConsent: 'accepted', tp_aid: 'visitor-123' }
    const one = runScript(['hero-1', 'cta-2'], { ...consented }, 0.1)
    const two = runScript(['hero-1', 'cta-2'], { ...consented }, 0.9)
    expect(one.assigned).toEqual(two.assigned)
    // Two experiments do not share one arm by construction.
    const arms = new Set(Object.values(one.assigned))
    expect(['a', 'b']).toEqual(expect.arrayContaining([...arms]))
    expect(one.styles).toHaveLength(1)
    expect(one.styles[0].split('}').filter(Boolean)).toHaveLength(2)
  })

  it('never throws when storage is unavailable, and still publishes an arm', () => {
    const fakeWindow = {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
    } as any
    const fakeDocument = {
      createElement: () => ({ textContent: '' }),
      head: { appendChild: () => undefined },
    }
    new Function('window', 'document', buildExperimentAssignmentScript(['hero-1']))(
      fakeWindow,
      fakeDocument
    )
    expect(['a', 'b']).toContain(fakeWindow.__tpExp['hero-1'])
  })
})
