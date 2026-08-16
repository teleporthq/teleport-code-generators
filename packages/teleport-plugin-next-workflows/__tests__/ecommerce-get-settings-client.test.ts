import { splitIntoSegments, generateSharedRuntimeUtilsCode } from '../src'
import { nodeRegistry } from '../src/nodes'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { UIDLWorkflow } from '@teleporthq/teleport-types'

// The /api/ecommerce/settings route returns a literal baked at generation time
// — within a deployment it can never say anything else. Classifying the
// `ecommerce-get-settings` node as a SERVER node therefore bought nothing and
// cost a full blocking round trip per click, PLUS it fragmented the
// surrounding workflow into extra server segments (one round trip each).
//
// The contract this file pins down:
//   1. the node is client-classified, so the segment splitter never mints a
//      server segment for it;
//   2. the client handler resolves from the baked window global first, then a
//      memoized fetch, then the route;
//   3. cron/webhook routes (which execute every node server-side, with no
//      window) still get a real server implementation via
//      generateServerHandler — never the client-only stub;
//   4. the add-to-cart / cart-increment workflow shapes collapse to exactly
//      ONE server segment: the product data-select.

describe('ecommerce-get-settings node classification', () => {
  const generator = nodeRegistry['ecommerce-get-settings']

  it('is client-classified', () => {
    expect(generator.executionEnv).toBe('client')
  })

  it('client handler reads the baked global, memoizes the fetch fallback', () => {
    const source = generator.generateHandler()
    expect(source).toContain('__teleportEcommerceSettings')
    expect(source).toContain('__teleportEcommerceSettingsFetched')
    expect(source).toContain('/api/ecommerce/settings')
  })

  it('keeps a real server implementation for cron/webhook contexts', () => {
    expect(generator.generateServerHandler).toBeDefined()
    const source = generator.generateServerHandler!()
    expect(source).toContain('/api/ecommerce/settings')
    expect(source).not.toContain('window')
  })
})

describe('ecommerce-get-settings client handler behaviour', () => {
  const buildHandler = () => {
    const source = nodeRegistry['ecommerce-get-settings'].generateHandler()
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(`return (${source})`)() as (
      config: unknown,
      context: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
  }

  const globalAny = global as unknown as Record<string, unknown>

  afterEach(() => {
    delete globalAny.window
    delete globalAny.fetch
  })

  it('returns the baked global without fetching', async () => {
    const baked = { guestCheckout: true, stockManagement: true, maxQuantityPerProduct: null }
    globalAny.window = { __teleportEcommerceSettings: baked }
    globalAny.fetch = jest.fn()

    const result = await buildHandler()({}, {})
    expect(result).toBe(baked)
    expect(globalAny.fetch).not.toHaveBeenCalled()
  })

  it('falls back to the route and memoizes a successful response', async () => {
    const payload = { guestCheckout: false, stockManagement: true }
    globalAny.window = {}
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    })
    globalAny.fetch = fetchMock

    const handler = buildHandler()
    const first = await handler({}, {})
    expect(first).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second call resolves from the memo — the route is immutable within a
    // deployment, so this can never serve stale data.
    const second = await handler({}, {})
    expect(second).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not memoize a failed response', async () => {
    globalAny.window = {}
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guestCheckout: true }) })
    globalAny.fetch = fetchMock

    const handler = buildHandler()
    const first = await handler({}, {})
    expect(first).toEqual({ error: 'Failed to load e-commerce settings' })

    const second = await handler({}, {})
    expect(second).toEqual({ guestCheckout: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('segment shapes around a client settings node', () => {
  const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    config,
    stepNumber: 0,
  })
  const edge = (source: string, target: string, sourceHandle?: string) => ({
    id: `${source}->${target}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  })

  it('cart-increment shape: ONE server segment holding only the data-select', () => {
    // trigger → data-select (server) → get-settings → validate (client js) → if
    const workflow = {
      nodes: [
        node('trigger', 'event-element-clicked', { isFirstNode: true }),
        node('fetch-product', 'data-select', { tableName: 'teleport_products' }),
        node('get-settings', 'ecommerce-get-settings'),
        node('validate', 'general-custom-js', {
          code: 'function customHandler(p){}',
          context: 'client',
        }),
        node('gate', 'general-if-statement', {}),
      ],
      edges: [
        edge('trigger', 'fetch-product'),
        edge('fetch-product', 'get-settings'),
        edge('get-settings', 'validate'),
        edge('validate', 'gate'),
      ],
    } as unknown as UIDLWorkflow

    const segments = splitIntoSegments(workflow)
    const serverSegments = segments.filter((s) => s.env === 'server')
    expect(serverSegments).toHaveLength(1)
    expect(serverSegments[0].nodes.map((n) => n.id)).toEqual(['fetch-product'])
  })

  it('add-to-cart shape: settings between client nodes mints NO server segment', () => {
    // extract (client js) → get-settings → guest-check (client js) → if →
    // [redirect | data-select] — only the data-select is a server segment.
    const workflow = {
      nodes: [
        node('extract', 'general-custom-js', {
          code: 'function customHandler(p){}',
          context: 'client',
        }),
        node('get-settings', 'ecommerce-get-settings'),
        node('guest-check', 'general-custom-js', {
          code: 'function customHandler(p){}',
          context: 'client',
        }),
        node('gate', 'general-if-statement', {}),
        node('redirect', 'navigation-navigate-to-url', { url: '/sign-in' }),
        node('fetch-product', 'data-select', { tableName: 'teleport_products' }),
      ],
      edges: [
        edge('extract', 'get-settings'),
        edge('get-settings', 'guest-check'),
        edge('guest-check', 'gate'),
        edge('gate', 'redirect', 'true'),
        edge('gate', 'fetch-product', 'false'),
      ],
    } as unknown as UIDLWorkflow

    const segments = splitIntoSegments(workflow)
    const serverSegments = segments.filter((s) => s.env === 'server')
    expect(serverSegments).toHaveLength(1)
    expect(serverSegments[0].nodes.map((n) => n.id)).toEqual(['fetch-product'])
  })
})

// ─── Dynamic fire-and-forget upgrade, end to end ─────────────────────────────
//
// Mirrors the "Resolve Current User" custom node's anonymous half: an
// if-statement routes a RETURNING guest to a fire-and-forget users-row
// re-ensure and a NEW guest to an awaited create. Both data nodes land in one
// server segment, so the segment is statically mixed (fireAndForget: false).
// When the taken branch leaves only fire-and-forget work live, the runtime
// must dispatch the segment WITHOUT awaiting; when the awaited branch is
// taken, it must still block.
describe('generated custom node — mixed segment upgrades to fire-and-forget per branch', () => {
  const customNodes = {
    'cn-resolve': {
      id: 'cn-resolve',
      name: 'Resolve-ish',
      parameters: [],
      nodes: [
        {
          id: 'extract',
          type: 'general-custom-js',
          label: 'Extract',
          config: {
            code: 'function customHandler(p, q) { return { returning: true } }',
            context: 'client',
          },
          executionEnv: 'client',
          stepNumber: 0,
        },
        {
          id: 'gate',
          type: 'general-if-statement',
          label: 'Returning Guest?',
          config: {
            conditionType: 'simple-comparison',
            leftValue: {
              type: 'workflowContext',
              nodeId: 'extract',
              path: ['extract', 'returning'],
            },
            operator: '===',
            rightValue: true,
          },
          executionEnv: 'client',
          stepNumber: 1,
        },
        {
          id: 'ensure',
          type: 'data-create-item',
          label: 'Ensure Row',
          config: { awaitResult: false },
          executionEnv: 'server',
          stepNumber: 2,
        },
        {
          id: 'create',
          type: 'data-create-item',
          label: 'Create Row',
          config: {},
          executionEnv: 'server',
          stepNumber: 2,
        },
        {
          id: 'return-stored',
          type: 'general-custom-js',
          label: 'Return Stored',
          config: {
            code: 'function customHandler(p, q) { return { branch: "stored" } }',
            context: 'client',
          },
          executionEnv: 'client',
          stepNumber: 3,
        },
        {
          id: 'return-new',
          type: 'general-custom-js',
          label: 'Return New',
          config: {
            code: 'function customHandler(p, q) { return { branch: "new" } }',
            context: 'client',
          },
          executionEnv: 'client',
          stepNumber: 3,
        },
      ],
      edges: [
        { id: 'e1', source: 'extract', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'ensure', sourceHandle: 'true' },
        { id: 'e3', source: 'gate', target: 'create', sourceHandle: 'false' },
        { id: 'e4', source: 'ensure', target: 'return-stored' },
        { id: 'e5', source: 'create', target: 'return-new' },
      ],
    },
  }

  interface BootedCustomNode {
    run: (
      outerContext: Record<string, unknown>,
      parameters: Record<string, unknown>,
      handlers: Record<string, unknown>
    ) => Promise<unknown>
    segmentCalls: string[]
    resolveSegment: () => void
  }

  const bootCustomNode = (): BootedCustomNode => {
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateCustomNodesFile: (
        nodes: Record<string, unknown>,
        urls: Record<string, Record<string, string>>
      ) => string
    }
    const source = plugin.generateCustomNodesFile(customNodes, {
      'cn-resolve': { 'server-1': '/api/workflows/resolve-seg-1' },
    })

    const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
      utilsModule,
      utilsModule.exports
    )

    const segmentCalls: string[] = []
    let releaseSegment: () => void = () => undefined
    const segmentGate = new Promise<void>((resolve) => {
      releaseSegment = resolve
    })
    const runtimeStub = {
      findStreamingAINodes: () => ({}),
      mergeServerResults: () => undefined,
      callStreamingServerSegment: async () => ({}),
      callServerSegment: async (url: string) => {
        segmentCalls.push(url)
        await segmentGate
        return {}
      },
    }

    const requireStub = (id: string) =>
      id === './runtime-utils' ? utilsModule.exports : id === './runtime' ? runtimeStub : {}

    const moduleStub: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', source)(
      moduleStub,
      moduleStub.exports,
      requireStub
    )

    const registry = moduleStub.exports as Record<string, BootedCustomNode['run']>
    return { run: registry['cn-resolve'], segmentCalls, resolveSegment: releaseSegment }
  }

  const handlersFor = (returning: boolean) => ({
    'general-custom-js': async (config: { code?: string }) => {
      const code = config && config.code ? config.code : ''
      if (code.includes('returning')) {
        return { returning }
      }
      if (code.includes('stored')) {
        return { branch: 'stored' }
      }
      return { branch: 'new' }
    },
  })

  it('returning-guest branch (only fire-and-forget live) does not await the segment', async () => {
    const booted = bootCustomNode()

    // The gate promise is never released — if the runtime awaited the segment
    // this would hang and jest would time the test out.
    const result = (await booted.run({}, {}, handlersFor(true))) as Record<string, unknown>

    expect(booted.segmentCalls).toEqual(['/api/workflows/resolve-seg-1'])
    expect(result).toEqual({ branch: 'stored' })

    booted.resolveSegment()
  })

  it('new-guest branch (awaited create live) still blocks on the segment', async () => {
    const booted = bootCustomNode()

    let settled = false
    const running = booted.run({}, {}, handlersFor(false)).then((value) => {
      settled = true
      return value
    })

    // Give the runtime ample turns to (incorrectly) run to completion.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(booted.segmentCalls).toEqual(['/api/workflows/resolve-seg-1'])
    expect(settled).toBe(false)

    booted.resolveSegment()
    const result = (await running) as Record<string, unknown>
    expect(result).toEqual({ branch: 'new' })
  })
})
