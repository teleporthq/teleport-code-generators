import * as vm from 'vm'
import generate from '@babel/generator'
import { ChunkDefinition, ProjectUIDL } from '@teleporthq/teleport-types'
import { nodeRegistry } from '@teleporthq/teleport-plugin-next-workflows'
import { createDocumentFileChunks } from '../src/utils'

/**
 * On a site with a cookie banner, Google Analytics and Tag Manager start in
 * Google's consent-denied mode and are granted when the visitor clicks Accept.
 * These tests run the scripts the generated `_document` actually emits, in
 * document order, in a browser window, then the banner's real Accept step.
 */

const GA_ASSETS = [
  {
    type: 'script',
    path: 'https://www.googletagmanager.com/gtag/js?id=G-TEST123',
    options: { target: 'body', async: true },
  },
  {
    type: 'script',
    content:
      "window.dataLayer = window.dataLayer || [];\n        function gtag(){dataLayer.push(arguments);}\n        gtag('js', new Date());\n        gtag('config', 'G-TEST123');",
    options: { target: 'body' },
  },
]

const GTM_ASSETS = [
  {
    type: 'script',
    content:
      "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n        })(window,document,'script','dataLayer','GTM-TEST45');",
    options: { target: 'body' },
  },
]

const answerWorkflow = (id: string, answer: 'accepted' | 'declined') => ({
  id,
  name: 'Cookie Consent ' + answer,
  trigger: {
    nodeId: id + '-trigger',
    type: 'event-element-clicked',
    config: { nodeId: 'button-' + answer },
    scope: 'element',
  },
  nodes: [
    {
      id: id + '-save',
      type: 'storage-local-set',
      label: 'Save',
      config: { key: 'cookieConsent', value: answer },
      executionEnv: 'client',
      stepNumber: 1,
    },
    {
      id: id + '-hide',
      type: 'state-update-local-state',
      label: 'Hide Cookie Consent',
      config: { property: 'cookieConsentVisible', value: false },
      executionEnv: 'client',
      stepNumber: 2,
    },
  ],
  edges: [{ id: id + '-edge', source: id + '-save', target: id + '-hide' }],
  usedInNodes: { ['button-' + answer]: true },
})

const BANNER = {
  workflows: {
    accept: answerWorkflow('accept', 'accepted'),
    decline: answerWorkflow('decline', 'declined'),
  },
}

const DECLINE_ONLY = { workflows: { decline: answerWorkflow('decline', 'declined') } }

const uidlWith = (assets: unknown[], workflows?: unknown): ProjectUIDL =>
  ({
    name: 'shop',
    globals: { settings: { title: 'Shop', language: 'en' }, meta: [], assets },
    ...(workflows ? { workflows } : {}),
    root: { name: 'App', node: { type: 'element', content: { elementType: 'Router' } } },
  } as unknown as ProjectUIDL)

const documentSource = (uidl: ProjectUIDL): string => {
  const chunks = createDocumentFileChunks(uidl, { assets: {} } as never)
  const chunk = (chunks.js as ChunkDefinition[])[0]
  return generate(chunk.content as never).code
}

const inlineScripts = (source: string): string[] =>
  Array.from(source.matchAll(/"__html": ("(?:[^"\\]|\\.)*")/g)).map((match) => JSON.parse(match[1]))

const CONSENT_DEFAULT = /gtag\('consent', 'default'/
const consentTagIndex = (source: string) => source.search(/"__html": "[^"]*consent/)

type Command = unknown[]

type Listener = (event: { type: string }) => void

/**
 * The browser globals the emitted scripts and the storage steps touch. Each
 * page is its own global scope, so listeners never leak between tests.
 */
function browserWindow() {
  const listeners: Record<string, Listener[]> = {}
  const values = new Map<string, string>()
  class BrowserEvent {
    type: string
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type
      this.detail = init?.detail
    }
  }
  const window: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => (values.has(key) ? values.get(key) : null),
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
    },
    document: {
      URL: 'https://shop.example.com/',
      getElementsByTagName: () => [{ parentNode: { insertBefore: () => undefined } }],
      createElement: () => ({}),
    },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = [...(listeners[type] || []), listener]
    },
    dispatchEvent: (event: { type: string }) => {
      const listening = listeners[event.type] || []
      listening.forEach((listener) => listener(event))
      return true
    },
    CustomEvent: BrowserEvent,
    StorageEvent: BrowserEvent,
  }
  window.window = window
  return vm.createContext(window)
}

/** A visitor's page: the emitted inline scripts run in document order. */
function loadPage(source: string, storedAnswer?: string) {
  const window = browserWindow()
  if (storedAnswer) {
    window.localStorage.setItem('cookieConsent', storedAnswer)
  }
  inlineScripts(source).forEach((script) => vm.runInContext(script, window))

  const entries = (): unknown[] => window.dataLayer || []
  // Google's tags run only commands pushed as `arguments` objects, never arrays.
  const isGtagCommand = (entry: unknown) =>
    Object.prototype.toString.call(entry) === '[object Arguments]'
  // A copy from this realm: the page's objects carry its own Object prototype.
  const commands = (): Command[] =>
    entries().map((entry) =>
      JSON.parse(
        JSON.stringify(isGtagCommand(entry) ? Array.from(entry as ArrayLike<unknown>) : [entry])
      )
    )
  const consentCommands = () => commands().filter((command) => command[0] === 'consent')
  const consentEntriesAreGtagCommands = () =>
    entries().filter(
      (entry) => isGtagCommand(entry) && (entry as ArrayLike<unknown>)[0] === 'consent'
    ).length === consentCommands().length

  const runWorkflowStep = (nodeType: string, config: Record<string, unknown>) => {
    const handler = vm.runInContext('(' + nodeRegistry[nodeType].generateHandler() + ')', window)
    return handler(config, {})
  }

  return { window, commands, consentCommands, consentEntriesAreGtagCommands, runWorkflowStep }
}

const DENIED = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
}
const GRANTED = {
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  analytics_storage: 'granted',
}

describe('Google consent mode on a site with a cookie banner', () => {
  it('emits the consent default in <head>, ahead of the Google tag and the Tag Manager container', () => {
    const source = documentSource(uidlWith([...GA_ASSETS, ...GTM_ASSETS], BANNER))

    const consentAt = consentTagIndex(source)
    expect(consentAt).toBeGreaterThan(-1)
    expect(consentAt).toBeLessThan(source.indexOf('</Head>'))
    expect(consentAt).toBeLessThan(source.indexOf('googletagmanager.com/gtag/js?id=G-TEST123'))
    expect(consentAt).toBeLessThan(source.indexOf("gtag('config', 'G-TEST123')"))
    expect(consentAt).toBeLessThan(source.indexOf('GTM-TEST45'))
  })

  it('starts denied, before GA configures and before GTM starts, for a visitor who has not answered', () => {
    const page = loadPage(documentSource(uidlWith([...GA_ASSETS, ...GTM_ASSETS], BANNER)))
    const commands = page.commands()

    expect(commands[0].slice(0, 2)).toEqual(['consent', 'default'])
    expect(commands[0][2]).toEqual({ ...DENIED, wait_for_update: 500 })
    expect(page.consentEntriesAreGtagCommands()).toBe(true)
    expect(commands.slice(1).map((command) => command[0])).toEqual([
      'js',
      'config',
      { 'gtm.start': expect.any(Number), event: 'gtm.js' },
    ])
  })

  it('starts granted for a visitor who accepted on an earlier page, with no denied step', () => {
    const page = loadPage(documentSource(uidlWith(GA_ASSETS, BANNER)), 'accepted')

    expect(page.consentCommands()).toEqual([['consent', 'default', GRANTED]])
  })

  it('grants at once, on the same page, when the visitor clicks Accept', async () => {
    const page = loadPage(documentSource(uidlWith(GA_ASSETS, BANNER)))

    await page.runWorkflowStep('storage-local-set', { key: 'cookieConsent', value: 'accepted' })

    const consent = page.consentCommands()
    expect(consent.map((command) => command[1])).toEqual(['default', 'update'])
    expect(consent[1][2]).toEqual(GRANTED)
    expect(page.consentEntriesAreGtagCommands()).toBe(true)
  })

  it('stays denied when the visitor clicks Decline', async () => {
    const page = loadPage(documentSource(uidlWith(GTM_ASSETS, BANNER)))

    await page.runWorkflowStep('storage-local-set', { key: 'cookieConsent', value: 'declined' })

    expect(page.consentCommands()).toEqual([
      ['consent', 'default', { ...DENIED, wait_for_update: 500 }],
    ])
  })

  it('stays denied for a visitor who declined on an earlier page', () => {
    const page = loadPage(documentSource(uidlWith(GA_ASSETS, BANNER)), 'declined')

    expect(page.consentCommands()).toEqual([
      ['consent', 'default', { ...DENIED, wait_for_update: 500 }],
    ])
  })

  it('grants in another open tab of the site when the visitor accepts in this one', () => {
    const page = loadPage(documentSource(uidlWith(GA_ASSETS, BANNER)))

    page.window.localStorage.setItem('cookieConsent', 'accepted')
    page.window.dispatchEvent(
      new page.window.StorageEvent('storage', { key: 'cookieConsent', newValue: 'accepted' })
    )

    expect(page.consentCommands()[1]).toEqual(['consent', 'update', GRANTED])
  })

  it('withdraws the grant when a workflow removes the stored answer', async () => {
    const page = loadPage(documentSource(uidlWith(GA_ASSETS, BANNER)), 'accepted')

    await page.runWorkflowStep('storage-local-remove', { key: 'cookieConsent' })

    expect(page.consentCommands()).toEqual([
      ['consent', 'default', GRANTED],
      ['consent', 'update', DENIED],
    ])
  })

  it('leaves unrelated storage writes alone', async () => {
    const page = loadPage(documentSource(uidlWith(GA_ASSETS, BANNER)))

    await page.runWorkflowStep('storage-local-set', { key: 'menuOpen', value: true })

    expect(page.consentCommands()).toHaveLength(1)
  })
})

describe('Google consent mode is left out', () => {
  const withoutConsentTag = (source: string) =>
    source.replace(
      /\n\s*<script dangerouslySetInnerHTML=\{\{\s*"__html": "[^"]*consent[^\n]*\n\s*\}\}><\/script>/,
      ''
    )

  it.each([
    ['Google Analytics', GA_ASSETS],
    ['Tag Manager', GTM_ASSETS],
    ['both', [...GA_ASSETS, ...GTM_ASSETS]],
  ])(
    'on a site with %s and no cookie banner: the document is the banner one minus the consent tag',
    (_, assets) => {
      const withBanner = documentSource(uidlWith(assets, BANNER))
      const withoutBanner = documentSource(uidlWith(assets))

      expect(withoutBanner).not.toMatch(CONSENT_DEFAULT)
      expect(withoutBanner).not.toContain('consent')
      expect(withBanner).not.toBe(withoutBanner)
      expect(withoutConsentTag(withBanner)).toBe(withoutBanner)
    }
  )

  it('on a site with a cookie banner and no Google tag', () => {
    expect(documentSource(uidlWith([], BANNER))).not.toContain('consent')
  })

  it('on a site whose banner has no Accept, since nothing could ever grant consent', () => {
    expect(documentSource(uidlWith(GA_ASSETS, DECLINE_ONLY))).not.toContain('consent')
  })

  it('for a visitor of a banner-less site, whose Google tags run with no consent command', () => {
    const page = loadPage(documentSource(uidlWith([...GA_ASSETS, ...GTM_ASSETS])))

    expect(page.consentCommands()).toEqual([])
    expect(page.commands().map((command) => command[0])).toEqual([
      'js',
      'config',
      { 'gtm.start': expect.any(Number), event: 'gtm.js' },
    ])
  })
})
