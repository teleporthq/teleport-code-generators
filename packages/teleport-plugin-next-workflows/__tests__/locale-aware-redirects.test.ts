import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import {
  generateCronAPIRoute,
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  generateWebhookWorkflowAPIRoute,
} from '../src/api-route-generator'
import { generateClientRuntimeCode } from '../src/executor-generator'
import { paymentChargeUser } from '../src/nodes/payment/payment-charge-user'
import {
  WORKFLOW_UTILS_ALIAS,
  workflowUtilsAliasLine,
  workflowUtilsImportLine,
} from '../src/workflow-utils-alias'
import { WorkflowSegment } from '../src/types'
import { loadHandler, HandlerFn } from './_helpers/load-handler'
import { bindWorkflowUtils } from './_helpers/bind-workflow-utils'
import { compileGeneratedMiddleware } from './_helpers/run-generated-middleware'

/**
 * A visitor who switched the site to Spanish must stay on the Spanish site
 * through every redirect the generated app performs: the account handlers'
 * "back to the home page", the navigation nodes, the payment provider's return
 * URLs and the middleware's sign-in redirect. Next.js serves the non-default
 * languages under a "/<locale>" prefix, so each of those has to put the run's
 * (or the request's) locale back on the path it builds. Executed, not grepped:
 * what matters is where the browser is sent.
 */

interface BrowserStub {
  location: { href: string }
  open: jest.Mock
  localStorage: { setItem: jest.Mock; removeItem: jest.Mock }
  dispatchEvent: jest.Mock
  setTimeout: (fn: () => void, ms: number) => void
  document: { createElement: () => Record<string, unknown>; body: { appendChild: jest.Mock } }
  __teleportNextAuth: Record<string, jest.Mock>
}

const installBrowser = (): BrowserStub => {
  const element = { textContent: '', setAttribute: jest.fn() }
  const browser: BrowserStub = {
    location: { href: '' },
    open: jest.fn(),
    localStorage: { setItem: jest.fn(), removeItem: jest.fn() },
    dispatchEvent: jest.fn(),
    // The farewell redirect is delayed so its toast is readable; run it now.
    setTimeout: (fn) => fn(),
    document: { createElement: () => element, body: { appendChild: jest.fn() } },
    __teleportNextAuth: {
      signIn: jest.fn(async () => ({})),
      signOut: jest.fn(async () => undefined),
    },
  }
  ;(globalThis as any).window = browser
  ;(globalThis as any).CustomEvent = class {
    public type: string
    public detail: unknown
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type
      this.detail = init ? init.detail : undefined
    }
  }
  return browser
}

const okJson = (payload: unknown) => async () => ({ ok: true, json: async () => payload })

describe('client handlers keep the language of the run', () => {
  let unbindWorkflowUtils: () => void
  let browser: BrowserStub

  beforeAll(() => {
    unbindWorkflowUtils = bindWorkflowUtils()
  })

  afterAll(() => {
    unbindWorkflowUtils()
  })

  beforeEach(() => {
    browser = installBrowser()
  })

  afterEach(() => {
    delete (globalThis as any).window
    delete (globalThis as any).CustomEvent
    delete (globalThis as any).fetch
  })

  it('account-login lands on the home page of the language signed in from', async () => {
    const handler: HandlerFn = loadHandler('account-login')
    ;(globalThis as any).fetch = okJson({ user: { id: 'u-1' } })
    await handler({ email: 'a@b.c', password: 'secret' }, { __locale: 'es' })
    expect(browser.location.href).toBe('/es')
    await handler({ email: 'a@b.c', password: 'secret' }, { __locale: 'en' })
    expect(browser.location.href).toBe('/')
  })

  it('account-signup lands on the home page of the language signed up from', async () => {
    const handler: HandlerFn = loadHandler('account-signup')
    ;(globalThis as any).fetch = okJson({ user: { id: 'u-1' } })
    await handler({ email: 'a@b.c', password: 'secret' }, { __locale: 'es' })
    expect(browser.location.href).toBe('/es')
    await handler({ email: 'a@b.c', password: 'secret' }, {})
    expect(browser.location.href).toBe('/')
  })

  it('account-logout lands on the home page of the language signed out from', async () => {
    const handler: HandlerFn = loadHandler('account-logout')
    await handler({}, { __locale: 'es' })
    expect(browser.location.href).toBe('/es')
  })

  it('account-delete-current lands on the configured page in the language deleted from', async () => {
    const handler: HandlerFn = loadHandler('account-delete-current')
    ;(globalThis as any).fetch = okJson({ success: true })
    await handler({ redirectTo: '/goodbye' }, { __locale: 'es' })
    expect(browser.location.href).toBe('/es/goodbye')
    await handler({}, { __locale: 'es' })
    expect(browser.location.href).toBe('/es')
  })

  it('account-social-login asks the provider to return to the language started from', async () => {
    const handler: HandlerFn = loadHandler('account-social-login')
    await handler({ provider: 'google' }, { __locale: 'es' })
    expect(browser.__teleportNextAuth.signIn).toHaveBeenCalledWith('google', {
      callbackUrl: '/es',
    })
    await handler({ provider: 'google', callbackUrl: '/my-profile' }, { __locale: 'es' })
    expect(browser.__teleportNextAuth.signIn).toHaveBeenLastCalledWith('google', {
      callbackUrl: '/es/my-profile',
    })
  })

  it('navigation-navigate-to-url localizes a site path and leaves everything else alone', async () => {
    const handler: HandlerFn = loadHandler('navigation-navigate-to-url')
    await handler({ url: '/sign-in' }, { __locale: 'es' })
    expect(browser.location.href).toBe('/es/sign-in')
    await handler({ url: '/sign-in', openInNewTab: true }, { __locale: 'es' })
    expect(browser.open).toHaveBeenCalledWith('/es/sign-in', '_blank')
    await handler({ url: 'https://example.com/x' }, { __locale: 'es' })
    expect(browser.location.href).toBe('https://example.com/x')
    await handler({ url: '/api/invoices/download?id=1' }, { __locale: 'es' })
    expect(browser.location.href).toBe('/api/invoices/download?id=1')
    await handler({ url: '/sign-in' }, {})
    expect(browser.location.href).toBe('/sign-in')
  })
})

describe('payment-charge-user returns the buyer to the language of the checkout', () => {
  let unbindWorkflowUtils: () => void

  beforeAll(() => {
    unbindWorkflowUtils = bindWorkflowUtils()
  })

  afterAll(() => {
    unbindWorkflowUtils()
  })

  const source = paymentChargeUser.generateHandler()
  // The entry and the helpers up to the real absolutizer; the provider calls
  // are stubbed to capture the URLs they were handed.
  const entrySource = source.slice(
    source.indexOf('async function payment_charge_user'),
    source.indexOf('function toStripeMinorUnits')
  )

  const charge = async (
    config: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const capture = async (
      _config: unknown,
      _currency: unknown,
      _amount: unknown,
      successUrl: string,
      cancelUrl: string
    ) => ({ successUrl, cancelUrl })
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'chargeWithStripe',
      'chargeWithPaypal',
      `${entrySource}\nreturn payment_charge_user;`
    )
    return factory(capture, capture)(config, context)
  }

  it('prefixes site-relative return paths with the run locale before absolutizing', async () => {
    const result = await charge(
      { successUrl: '/orders/ORD-42?payment=success', cancelUrl: '/checkout', amount: 10 },
      { __baseUrl: 'https://shop.test', __locale: 'es' }
    )
    expect(result).toEqual({
      successUrl: 'https://shop.test/es/orders/ORD-42?payment=success',
      cancelUrl: 'https://shop.test/es/checkout',
    })
  })

  it('keeps the bare paths for the default language and an external override untouched', async () => {
    expect(
      await charge(
        { successUrl: '/orders/ORD-42', cancelUrl: 'https://pay.example/back', amount: 10 },
        { __baseUrl: 'https://shop.test', __locale: 'en' }
      )
    ).toEqual({
      successUrl: 'https://shop.test/orders/ORD-42',
      cancelUrl: 'https://pay.example/back',
    })
    expect(
      await charge({ successUrl: '/orders/ORD-42', amount: 10 }, { __baseUrl: 'https://shop.test' })
    ).toMatchObject({ successUrl: 'https://shop.test/orders/ORD-42' })
  })
})

describe('every file that inlines handlers binds the shared runtime alias', () => {
  const segment: WorkflowSegment = {
    id: 'seg-1',
    env: 'server',
    nodeIds: ['n1'],
    nodes: [
      {
        id: 'n1',
        type: 'payment-charge-user',
        config: { amount: 10 },
        executionEnv: 'server',
        stepNumber: 1,
        label: 'Charge',
      } as any,
    ],
    edges: [],
  }
  const workflow = {
    id: 'wf-1',
    name: 'WF',
    nodes: [segment.nodes[0]],
    edges: [],
  }

  it('api routes alias the runtime they already require', () => {
    const routes = [
      generateServerSegmentAPIRoute(segment, 'wf'),
      generateStreamingServerSegmentAPIRoute(segment, 'wf'),
      generateCronAPIRoute({
        ...workflow,
        trigger: {
          type: 'event-cron-triggered',
          nodeId: 't',
          scope: 'global',
          config: { schedule: '0 * * * *', urlPath: 'cron_x' },
        },
      } as any),
      generateWebhookWorkflowAPIRoute({
        ...workflow,
        trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
        webhookConfig: { urlPath: 'hooks/x', httpMethod: 'POST', signatureSecret: '' },
      } as any),
    ]
    for (const route of routes) {
      const aliasAt = route.indexOf(workflowUtilsAliasLine('utils'))
      expect(aliasAt).toBeGreaterThan(route.indexOf('server-runtime'))
      expect(aliasAt).toBeLessThan(route.indexOf('const nodeHandlers = {'))
    }
  })

  it('the global workflows hook imports the runtime as an ES module', () => {
    const plugin = new NextWorkflowProjectPlugin()
    const hook: string = (plugin as any).generateGlobalWorkflowsHook([
      {
        id: 'global-wf',
        trigger: { type: 'event-custom-triggered', config: { eventName: 'x' } },
        nodes: [
          {
            id: 'n1',
            type: 'navigation-navigate-to-url',
            config: { url: '/sign-in' },
            stepNumber: 1,
          },
        ],
        edges: [],
      },
    ])
    expect(hook).toContain(workflowUtilsImportLine('./runtime-utils'))
    // Pure ESM, like the runtime import beside it (see the hook's emitter).
    expect(hook).not.toContain(`${WORKFLOW_UTILS_ALIAS} = require(`)
    expect(hook.indexOf(workflowUtilsImportLine('./runtime-utils'))).toBeLessThan(
      hook.indexOf('export function useGlobalWorkflows')
    )
  })

  it('the client runtime localizes a terminal redirect it performs itself', () => {
    expect(generateClientRuntimeCode()).toContain(
      'window.location.href = utils.localizeHref(__redirectUrl, context.__locale);'
    )
  })
})

describe('middleware redirects keep the request locale', () => {
  const auth: any = {
    enabled: true,
    dataSourceId: 'ds-1',
    dataSourceType: 'postgres',
    passwordAuthEnabled: true,
    providers: [],
    roles: ['admin'],
    tables: {},
    folderProtection: {},
    authPages: {
      signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' },
      signUp: { pageId: 'sign-up', pageName: 'sign-up', route: '/sign-up' },
    },
    pageProtection: {
      ORDERS: { requiresAuth: true, allowedRoles: [], pageName: 'Orders', route: '/orders' },
      ADMIN: {
        requiresAuth: true,
        allowedRoles: ['admin'],
        pageName: 'Admin',
        route: '/admin',
      },
    },
    callbackBaseUrl: '',
    envKeys: {},
    customUserProperties: [],
  }
  const run = compileGeneratedMiddleware(auth)

  it('sends a guest to the sign-in page of the language they were browsing in', async () => {
    const result = await run('/orders', { locale: 'es', defaultLocale: 'en' })
    expect(result).toEqual({
      kind: 'redirect',
      location: 'https://shop.test/es/sign-in?callbackUrl=%2Fes%2Forders',
    })
  })

  it('keeps the bare routes for the default language and for a project without languages', async () => {
    expect(await run('/orders', { locale: 'en', defaultLocale: 'en' })).toEqual({
      kind: 'redirect',
      location: 'https://shop.test/sign-in?callbackUrl=%2Forders',
    })
    expect(await run('/orders')).toEqual({
      kind: 'redirect',
      location: 'https://shop.test/sign-in?callbackUrl=%2Forders',
    })
  })

  it('sends a signed-in visitor without the role to the home page of their language', async () => {
    const result = await run('/admin', {
      locale: 'es',
      defaultLocale: 'en',
      sessionUser: { id: 'u-1', role: 'user' },
    })
    expect(result).toEqual({ kind: 'redirect', location: 'https://shop.test/es' })
  })
})
