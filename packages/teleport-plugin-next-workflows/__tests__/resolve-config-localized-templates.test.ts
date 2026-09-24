import {
  generateClientRuntimeCode,
  generateSharedRuntimeUtilsCode,
} from '../src/executor-generator'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { nodeRegistry } from '../src'
import { EMAIL_LOCALE_HEADER } from '../src/email-locale'

/**
 * A customer email carries one copy per project language on its node config
 * (`localizedTemplates`, written by the editor's UIDL mapper). The runtime has
 * to pick the copy of the language the visitor is browsing in — or, for an
 * email bound to a stored locale (an order's, a cart's), that language — and
 * it has to do so in `resolveConfig`, the one function every execution path
 * funnels a node config through, BEFORE the `{{token}}` fill.
 *
 * Executed, not grepped: what matters is which body a provider handler
 * receives.
 */

type ResolveConfig = (
  config: Record<string, unknown>,
  context: Record<string, unknown>
) => Record<string, unknown>

interface Runtime {
  resolveConfig: ResolveConfig
  resolveEmailLocale: (config: Record<string, unknown>, context: Record<string, unknown>) => string
  resolveWorkflowLocale: (req: unknown, incomingContext: unknown) => string
  getClientLocale: () => string | null
}

function loadRuntime(emailLocales?: { locales: string[]; defaultLocale: string }): Runtime {
  const code = generateSharedRuntimeUtilsCode(emailLocales ? { emailLocales } : {})
  const moduleShim = { exports: {} as Runtime }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', code)(
    moduleShim,
    moduleShim.exports,
    () => ({}),
    { env: {} }
  )
  return moduleShim.exports
}

const wfCtx = (nodeId: string, path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

const emailConfig = (over: Record<string, unknown> = {}) => ({
  to: 'jane@example.com',
  subject: 'Your order {{orderNumber}} shipped',
  body: '<p>Hi {{customerName}}, order {{orderNumber}} is on its way.</p>',
  localizedTemplates: {
    es: {
      subject: 'Tu pedido {{orderNumber}} ha sido enviado',
      body: '<p>Hola {{customerName}}, el pedido {{orderNumber}} está en camino.</p>',
    },
    fr: { body: '<p>Bonjour {{customerName}}, la commande {{orderNumber}} est en route.</p>' },
  },
  templateParams: [
    { key: 'customerName', value: wfCtx('tokens', ['customerName']) },
    { key: 'orderNumber', value: wfCtx('tokens', ['orderNumber']) },
  ],
  ...over,
})

const tokens = { customerName: 'Jane', orderNumber: 'ORD-42' }

describe('resolveConfig picks the localized email copy', () => {
  const runtime = loadRuntime({ locales: ['en', 'es', 'fr'], defaultLocale: 'en' })

  it('sends the copy of the language the run started in, tokens filled', () => {
    const resolved = runtime.resolveConfig(emailConfig(), { tokens, __locale: 'es' })
    expect(resolved.subject).toBe('Tu pedido ORD-42 ha sido enviado')
    expect(resolved.body).toBe('<p>Hola Jane, el pedido ORD-42 está en camino.</p>')
  })

  it('keeps the main subject when the language copy has none', () => {
    const resolved = runtime.resolveConfig(emailConfig(), { tokens, __locale: 'fr' })
    expect(resolved.subject).toBe('Your order ORD-42 shipped')
    expect(resolved.body).toBe('<p>Bonjour Jane, la commande ORD-42 est en route.</p>')
  })

  it('sends the main copy for the default language and for a run without a locale', () => {
    for (const context of [{ tokens, __locale: 'en' }, { tokens }, { tokens, __locale: 'de' }]) {
      const resolved = runtime.resolveConfig(emailConfig(), context)
      expect(resolved.subject).toBe('Your order ORD-42 shipped')
      expect(resolved.body).toBe('<p>Hi Jane, order ORD-42 is on its way.</p>')
    }
  })

  it('never lets the per-language map reach the provider handler', () => {
    const resolved = runtime.resolveConfig(emailConfig(), { tokens, __locale: 'es' })
    expect(resolved).not.toHaveProperty('localizedTemplates')
    expect(resolved).not.toHaveProperty('emailLocale')
  })

  it('lets a bound locale (the order’s) override the run’s language', () => {
    const resolved = runtime.resolveConfig(
      emailConfig({ emailLocale: wfCtx('tokens', ['locale']) }),
      { tokens: { ...tokens, locale: 'es' }, __locale: 'fr' }
    )
    expect(resolved.body).toBe('<p>Hola Jane, el pedido ORD-42 está en camino.</p>')
    expect(resolved).not.toHaveProperty('emailLocale')
  })

  it('treats an EMPTY bound locale as the default language, never the run’s', () => {
    // An admin shipping an order from the Spanish admin is not the buyer: an
    // order written before the locale column existed must not inherit the
    // admin's language.
    const resolved = runtime.resolveConfig(
      emailConfig({ emailLocale: wfCtx('tokens', ['locale']) }),
      { tokens: { ...tokens, locale: null }, __locale: 'es' }
    )
    expect(resolved.body).toBe('<p>Hi Jane, order ORD-42 is on its way.</p>')
  })

  it('resolves a bound locale case-insensitively to the canonical code', () => {
    expect(runtime.resolveEmailLocale({ emailLocale: 'ES' }, { __locale: 'fr' })).toBe('es')
    expect(runtime.resolveEmailLocale({}, { __locale: 'FR' })).toBe('fr')
    expect(runtime.resolveEmailLocale({}, {})).toBe('en')
  })

  it('leaves a raw-bodied node without copies untouched', () => {
    const resolved = runtime.resolveConfig(
      { subject: 'Plain', body: '<p>Plain</p>', to: 'a@b.c' },
      { __locale: 'es' }
    )
    expect(resolved).toEqual({ subject: 'Plain', body: '<p>Plain</p>', to: 'a@b.c' })
  })
})

describe('resolveWorkflowLocale', () => {
  const runtime = loadRuntime({ locales: ['en', 'es'], defaultLocale: 'en' })

  it('trusts the (validated) locale the client context carried', () => {
    expect(
      runtime.resolveWorkflowLocale(
        { headers: { [EMAIL_LOCALE_HEADER]: 'en' } },
        { __locale: 'es' }
      )
    ).toBe('es')
  })

  it('reads the request when the context carries nothing usable', () => {
    expect(
      runtime.resolveWorkflowLocale(
        { headers: { referer: 'https://x/es/cart' } },
        { __locale: 'xx' }
      )
    ).toBe('es')
    expect(runtime.resolveWorkflowLocale({ headers: {} }, {})).toBe('en')
  })
})

describe('a project without internationalization', () => {
  const runtime = loadRuntime()

  it('keeps the single template even when a copy map is present', () => {
    const resolved = runtime.resolveConfig(emailConfig(), { tokens, __locale: 'es' })
    expect(resolved.body).toBe('<p>Hi Jane, order ORD-42 is on its way.</p>')
    expect(resolved).not.toHaveProperty('localizedTemplates')
  })

  it('has no client locale outside a browser', () => {
    expect(runtime.getClientLocale()).toBeNull()
  })
})

describe('server segment routes carry the run locale', () => {
  const segment = {
    id: 'seg-1',
    env: 'server' as const,
    nodes: [
      {
        id: 'email-1',
        type: 'email-resend',
        config: { to: 'a@b.c', subject: 'S', body: 'B' },
        executionEnv: 'server' as const,
        stepNumber: 1,
        label: 'Send',
      },
    ],
    edges: [] as any[],
  }

  it('sets context.__locale from the client context or the request', () => {
    const code = generateServerSegmentAPIRoute(segment as any, 'wf')
    expect(code).toContain('context.__locale = utils.resolveWorkflowLocale(req, incomingContext);')
  })

  it('does so in the streaming route too', () => {
    const code = generateStreamingServerSegmentAPIRoute(segment as any, 'wf')
    expect(code).toContain('context.__locale = utils.resolveWorkflowLocale(req, body.context);')
  })
})

describe('account routes receive the page language', () => {
  it('signup and delete handlers send the locale header the routes read', () => {
    for (const nodeType of ['account-signup', 'account-delete-current']) {
      const source = nodeRegistry[nodeType].generateHandler()
      expect(source).toContain(`'${EMAIL_LOCALE_HEADER}'`)
      expect(source).toContain('__locale')
    }
  })

  it('the signup handler never forwards the per-language copies as user columns', () => {
    expect(nodeRegistry['account-signup'].generateHandler()).toContain('localizedTemplates: true')
  })
})

describe('the client runtime stamps the page language on every run', () => {
  const extractBuildContext = (): ((
    config: unknown,
    trigger: unknown
  ) => Record<string, unknown>) => {
    const src = generateClientRuntimeCode()
    const match = src.match(/function buildContext\b[\s\S]*?\n\}/)
    if (!match) {
      throw new Error('buildContext not found in generated runtime')
    }
    // eslint-disable-next-line no-new-func
    return new Function('utils', `${match[0]}\nreturn buildContext;`)(
      loadRuntime({ locales: ['en', 'es'], defaultLocale: 'en' })
    )
  }

  const withWindow = <T>(locale: string | undefined, run: () => T): T => {
    const globalRef = globalThis as { window?: unknown; document?: unknown }
    globalRef.window = { __NEXT_DATA__: { locale } }
    globalRef.document = { documentElement: { lang: '' } }
    try {
      return run()
    } finally {
      delete globalRef.window
      delete globalRef.document
    }
  }

  it('reads the active Next.js locale into context.__locale', () => {
    const buildContext = extractBuildContext()
    const context = withWindow('es', () => buildContext({ triggerNodeId: 't' }, { clicked: true }))
    expect(context.__locale).toBe('es')
    expect(context.t).toEqual({ clicked: true })
  })

  it('leaves the context without a locale when the page has none the project knows', () => {
    const buildContext = extractBuildContext()
    expect(
      withWindow(undefined, () => buildContext({ triggerNodeId: 't' }, {}))
    ).not.toHaveProperty('__locale')
    expect(withWindow('de', () => buildContext({ triggerNodeId: 't' }, {}))).not.toHaveProperty(
      '__locale'
    )
  })
})
