import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { buildGateHeadSnippet } from '../src/access-rules/gate-runtime-source'
import { AccessRulesSettings } from '../src/access-rules/settings'
import { StaticExportProjectPlugin } from '../src/static-export/project-plugin'

/**
 * A download other than the Next.js app runs no workflows: its age gate is
 * driven by the gate's head snippet alone (the style hides it, the snippet
 * answers its controls by their marks), and its popups are left out.
 */

const SETTINGS: AccessRulesSettings = {
  ageGateEnabled: true,
  minimumAge: 18,
  ageGateMode: 'confirm',
  ageGateScope: 'site',
  rememberDays: 30,
  allowCrawlers: true,
  geoMode: 'off',
  geoCountries: [],
  geoUnknownCountry: 'allow',
}
const RUNTIME = { gatedPaths: [] as string[], unavailablePaths: ['/unavailable'] }

/** A control the visitor clicks: itself for the marks it carries, the gate around it. */
const control = (marks: string[], gate: unknown) => {
  const element = {
    closest: (selector: string): unknown =>
      selector === '[data-tq-age-gate]'
        ? gate
        : marks.some((mark) => selector === `[${mark}]`)
        ? element
        : null,
  }
  return element
}

function openPage(pathname: string, settings = SETTINGS, runtime = RUNTIME) {
  const attributes: Record<string, string> = {}
  let click: (event: { target: unknown }) => void = () => undefined
  const fakeDocument = {
    cookie: '',
    readyState: 'complete',
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value
      },
    },
    head: { appendChild: () => undefined },
    body: { querySelector: () => ({}) },
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => undefined }),
    addEventListener: (type: string, listener: (event: { target: unknown }) => void) => {
      if (type === 'click') {
        click = listener
      }
    },
  }
  const told: string[] = []
  const fakeWindow = {
    addEventListener: () => undefined,
    dispatchEvent: (event: { type: string }) => told.push(event.type),
  }
  const snippet = buildGateHeadSnippet(settings, runtime, { withoutWorkflows: true })
  const script = snippet.slice(snippet.indexOf('<script>') + 8, snippet.lastIndexOf('</script>'))
  new Function('window', 'document', 'location', 'history', 'CustomEvent', script)(
    fakeWindow,
    fakeDocument,
    { pathname, protocol: 'https:' },
    { pushState: () => undefined, replaceState: () => undefined },
    function CustomEvent(this: { type: string }, type: string) {
      this.type = type
    }
  )
  return {
    gate: () => attributes['data-tq-age-gate'],
    cookie: () => fakeDocument.cookie,
    click: (target: unknown) => click({ target }),
    told,
  }
}

describe('the age gate in a download that runs no workflows', () => {
  it('lets the visitor in when they press the confirm button, and remembers it', () => {
    const page = openPage('/index.html')
    expect(page.gate()).toBe('open')

    page.click(control(['data-tq-age-gate-confirm'], null))
    expect(page.gate()).toBe('hidden')
    expect(page.cookie()).toBe('tq_age_ok=18; Path=/; SameSite=Lax; Max-Age=2592000; Secure')
    // Nothing waits for a component that listens for no event here.
    expect(page.told).toEqual([])
  })

  it('checks a date of birth: an adult goes in, a minor is shown the gate’s error', () => {
    const removed: string[] = []
    const birthGate = (value: string) => ({
      querySelector: (selector: string) =>
        selector === '[data-tq-age-gate-birthdate]'
          ? { value }
          : selector === '[data-tq-age-gate-error]'
          ? { removeAttribute: (name: string) => removed.push(name) }
          : null,
    })
    const page = openPage('/', { ...SETTINGS, ageGateMode: 'birthdate' })

    page.click(control(['data-tq-age-gate-submit'], birthGate('2020-05-01')))
    expect(page.gate()).toBe('open')
    expect(removed).toEqual(['hidden'])

    page.click(control(['data-tq-age-gate-submit'], birthGate('1990-05-01')))
    expect(page.gate()).toBe('hidden')
  })

  it('reads an HTML page’s file name as its path', () => {
    const scoped = { ...SETTINGS, ageGateScope: 'pages' as const }
    const shop = { ...RUNTIME, gatedPaths: ['/shop'] }
    expect(openPage('/shop.html', scoped, shop).gate()).toBe('open')
    expect(openPage('/index.html', scoped, shop).gate()).toBe('hidden')
    expect(openPage('/unavailable.html').gate()).toBe('hidden')
  })

  it('leaves the published site’s script exactly as it was', () => {
    const published = buildGateHeadSnippet(SETTINGS, RUNTIME)
    expect(published).toBe(buildGateHeadSnippet(SETTINGS, RUNTIME, { withoutWorkflows: false }))
    expect(published).not.toContain('data-tq-age-gate-confirm')
    expect(published).not.toContain('.html')
    expect(published).toContain('if (++tries < 40) setTimeout(tick, 250);')
  })
})

describe('StaticExportProjectPlugin', () => {
  const s = (content: unknown) => ({ type: 'static', content })
  const instance = (name: string) => ({
    type: 'element',
    content: { elementType: 'component', semanticType: name, dependency: { type: 'local' } },
  })
  const structureWith = (extra: Record<string, unknown>) =>
    ({
      uidl: {
        name: 'p',
        globals: { settings: { title: 'P', language: 'en' }, assets: [] },
        root: {
          name: 'App',
          node: {
            type: 'element',
            content: {
              elementType: 'container',
              children: [
                instance('Hero'),
                instance('WelcomePopup'),
                {
                  type: 'conditional',
                  content: {
                    node: instance('WelcomePopup'),
                    reference: { type: 'dynamic', content: { referenceType: 'state', id: 'x' } },
                    value: true,
                  },
                },
                { type: 'element', content: { elementType: 'text', children: [s('Hi')] } },
              ],
            },
          },
        },
        components: {
          WelcomePopup: {
            name: 'WelcomePopup',
            node: { type: 'element', content: { elementType: 'container', children: [] } },
          },
        },
        ...extra,
      },
      files: new Map(),
      dependencies: {},
      devDependencies: {},
      template: { files: [], subFolders: [] },
    } as unknown as ProjectPluginStructure)

  it('leaves out the popups and keeps everything else', async () => {
    const structure = structureWith({
      popups: { popups: [{ id: 'p1', componentName: 'WelcomePopup' }], excludedPaths: [] },
    })
    await new StaticExportProjectPlugin().runBefore(structure)
    const children = (structure.uidl.root.node.content as { children: unknown[] }).children
    expect(children).toEqual([
      instance('Hero'),
      { type: 'element', content: { elementType: 'text', children: [s('Hi')] } },
    ])
    expect(structure.uidl.globals.customCode).toBeUndefined()
  })

  it('puts the gate’s snippet for downloads first in the head', async () => {
    const structure = structureWith({
      plugins: {
        accessRules: {
          settings: { ageGateEnabled: true },
          data: { gate: 'component', gatedPaths: [] },
        },
      },
    })
    structure.uidl.globals.customCode = { head: '<meta name="x">' }
    await new StaticExportProjectPlugin().runBefore(structure)
    const head = structure.uidl.globals.customCode.head
    expect(head.startsWith('<style>html[data-tq-age-gate="hidden"]')).toBe(true)
    expect(head).toContain('"confirm":"data-tq-age-gate-confirm"')
    expect(head.endsWith('<meta name="x">')).toBe(true)
  })

  it('keeps an A/B test’s original and leaves out its variation', async () => {
    const version = (id: string, variant: string, label: string) => ({
      type: 'element',
      content: {
        elementType: 'container',
        attrs: { 'data-tq-exp': s(id), 'data-tq-exp-variant': s(variant) },
        children: [s(label)],
      },
    })
    const structure = structureWith({})
    const page = structure.uidl.root.node.content as { children: unknown[] }
    page.children = [
      version('hero-1', 'a', 'Original'),
      version('hero-1', 'b', 'Variation'),
      // Not an id the generator acts on: left as it is.
      version('NOT AN ID', 'b', 'Unmarked'),
    ]
    await new StaticExportProjectPlugin().runBefore(structure)
    expect(page.children).toEqual([
      version('hero-1', 'a', 'Original'),
      version('NOT AN ID', 'b', 'Unmarked'),
    ])
  })

  it('changes nothing in a project with none of them', async () => {
    const structure = structureWith({})
    const before = JSON.stringify(structure.uidl)
    await new StaticExportProjectPlugin().runBefore(structure)
    expect(JSON.stringify(structure.uidl)).toBe(before)
  })
})
