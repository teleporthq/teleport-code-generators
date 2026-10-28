import * as crypto from 'crypto'
import * as net from 'net'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import {
  generateClientRuntimeCode,
  generateSharedRuntimeUtilsCode,
} from '../src/executor-generator'
import { generateSecurityRuntimeCode, TOO_MANY_REQUESTS_MESSAGE } from '../src/security-runtime'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// A step the server refuses for its rate limit (a placed order past the
// visitor's limit, a guest booking, a newsletter signup) answers 429. The
// browser runtime used to end the run quietly there, so the workflow's error
// branch never cleared the busy flag: the button stayed on "Processing" with no
// message. Now the error branch runs with the server's public sentence and
// `rateLimited: true` (Task 4 review, I3). These run the GENERATED limited
// route and the GENERATED browser runtime against each other.

const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'rate-limit-branch-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

const placeNode = {
  id: 'place',
  type: 'general-custom-js',
  label: 'Place The Order',
  stepNumber: 2,
  executionEnv: 'server',
  config: {
    context: 'server',
    code: 'function customHandler(params) { return { placed: true } }',
    // One order per visitor per hour.
    visitorLimit: { limit: 1, windowSeconds: 3600 },
  },
}

function bootLimitedRoute(serverNode: Record<string, unknown> = placeNode) {
  const noop = (): undefined => undefined
  const security = { exports: {} as any }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    'module',
    'exports',
    'require',
    'process',
    'console',
    'Buffer',
    'Date',
    generateSecurityRuntimeCode()
  )(
    security,
    security.exports,
    (id: string) => (id === 'crypto' ? crypto : id === 'net' ? net : (null as never)),
    { env: {} },
    { warn: noop, error: noop, log: noop },
    Buffer,
    Date
  )
  const runtime = loadServerRuntime()
  const segment = {
    id: 'server-1',
    env: 'server',
    nodeIds: [serverNode.id],
    nodes: [serverNode],
    edges: [],
    entryNodeIds: [serverNode.id],
  } as unknown as WorkflowSegment
  const routeModule: { exports: any } = { exports: {} }
  const requireStub = (id: string) =>
    id.endsWith('server-runtime')
      ? runtime
      : id.endsWith('security-runtime')
      ? security.exports
      : {}
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(segment, 'Place'))(
    routeModule,
    routeModule.exports,
    requireStub
  )
  return routeModule.exports as (req: unknown, res: unknown) => Promise<void>
}

function loadBrowserRuntime() {
  const utils = { exports: {} as any }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utils,
    utils.exports,
    () => ({})
  )
  const client = { exports: {} as any }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateClientRuntimeCode())(
    client,
    client.exports,
    (id: string) => (id === './runtime-utils' ? utils.exports : (null as never))
  )
  return client.exports
}

// The generated routes the browser's fetch is answered by, by URL.
const routes: Record<string, (req: unknown, res: unknown) => Promise<void>> = {
  '/api/workflows/place': bootLimitedRoute(),
  // A rate-limiter step with its author's own sentence (one signup a minute).
  '/api/workflows/signup': bootLimitedRoute({
    id: 'place',
    type: 'general-rate-limiter',
    label: 'One Signup A Minute',
    stepNumber: 2,
    executionEnv: 'server',
    config: {
      strategy: 'ip',
      maxRequests: 1,
      windowMs: 60000,
      message: 'Slow down: one signup per minute.',
    },
  }),
  // The checkout's order limit (ORDER_ROW_VISITOR_LIMIT's shape: refuse, with its message).
  '/api/workflows/order': bootLimitedRoute({
    ...placeNode,
    config: {
      ...placeNode.config,
      visitorLimit: {
        limit: 1,
        windowSeconds: 900,
        onLimit: 'refuse',
        message:
          'Too many orders were placed from your network in the last few minutes. Please wait a little and try again.',
      },
    },
  }),
}

describe('a 429 from a limited server step', () => {
  const runtime = loadBrowserRuntime()
  const scope = globalThis as Record<string, unknown>
  const savedFetch = scope.fetch

  beforeAll(() => {
    // The browser's fetch, answered by the generated route.
    scope.fetch = async (url: string, init: { body: string }) => {
      const route = routes[url]
      const reply = { status: 200, body: null as any }
      const res = {
        setHeader: (): undefined => undefined,
        status(code: number) {
          reply.status = code
          return this
        },
        json(payload: unknown) {
          reply.body = payload
          return this
        },
      }
      await route(
        {
          method: 'POST',
          body: JSON.parse(init.body),
          headers: { host: 'shop.test' },
          socket: { remoteAddress: '203.0.113.9' },
        },
        res
      )
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        statusText: '',
        json: async () => reply.body,
      }
    }
  })
  afterAll(() => {
    scope.fetch = savedFetch
  })

  // trigger → set busy (browser) → place (server, limited); on error: clear busy + toast.
  const nodes = [
    { id: 'trigger', type: 'event-element-clicked', stepNumber: 0, config: {} },
    {
      id: 'busy',
      type: 'state-update-local-state',
      stepNumber: 1,
      config: { property: 'isPlacingOrder', value: 'true' },
    },
    { id: 'place', type: 'general-custom-js', stepNumber: 2, executionEnv: 'server', config: {} },
    { id: 'onError', type: 'event-workflow-error', stepNumber: 10, config: {} },
    {
      id: 'clearBusy',
      type: 'state-update-local-state',
      stepNumber: 11,
      config: { property: 'isPlacingOrder', value: 'false' },
    },
  ]
  const edges = [
    { id: 'e1', source: 'trigger', target: 'busy' },
    { id: 'e2', source: 'busy', target: 'place' },
    { id: 'e3', source: 'onError', target: 'clearBusy' },
  ]
  const workflowConfig = (withErrorBranch: boolean) => ({
    triggerNodeId: 'trigger',
    nodes,
    edges,
    ...(withErrorBranch ? { errorHandlerNodeId: 'onError' } : {}),
    segments: [
      { id: 'client-1', env: 'client', nodes: [nodes[1]], edges: [] },
      { id: 'server-1', env: 'server', nodes: [nodes[2]], edges: [] },
    ],
  })

  const runWith = async (withErrorBranch: boolean, url = '/api/workflows/place') => {
    const state: Record<string, string> = {}
    let errorSeen: any = null
    const handlers = {
      'state-update-local-state': async (
        config: { property: string; value: string },
        stepContext: any
      ) => {
        state[config.property] = config.value
        if (config.value === 'false') {
          errorSeen = stepContext.onError
        }
        return { updated: true }
      },
    }
    const context = await runtime.executeWorkflowWithSegments(
      workflowConfig(withErrorBranch),
      {},
      handlers,
      { 'server-1': url }
    )
    return { state, errorSeen, context }
  }

  it('runs the error branch with the server sentence, so the busy flag is released', async () => {
    const first = await runWith(true)
    expect(first.context.place).toEqual({ placed: true })
    expect(first.state.isPlacingOrder).toBe('true')

    const limited = await runWith(true)
    expect(limited.context.place).toBeUndefined()
    expect(limited.state.isPlacingOrder).toBe('false')
    expect(limited.errorSeen).toMatchObject({
      errorMessage: TOO_MANY_REQUESTS_MESSAGE,
      rateLimited: true,
    })
  })

  it("shows a rate-limiter step's own sentence, not the generic one beside it", async () => {
    await runWith(true, '/api/workflows/signup')
    const limited = await runWith(true, '/api/workflows/signup')
    expect(limited.state.isPlacingOrder).toBe('false')
    expect(limited.errorSeen).toMatchObject({
      errorMessage: 'Slow down: one signup per minute.',
      rateLimited: true,
    })
  })

  it("shows the order limit's sentence past it", async () => {
    await runWith(true, '/api/workflows/order')
    const limited = await runWith(true, '/api/workflows/order')
    expect(limited.state.isPlacingOrder).toBe('false')
    expect(limited.errorSeen).toMatchObject({
      errorMessage:
        'Too many orders were placed from your network in the last few minutes. Please wait a little and try again.',
      rateLimited: true,
    })
  })

  it('still ends quietly when the workflow has no error branch', async () => {
    const quiet = await runWith(false)
    expect(quiet.state.isPlacingOrder).toBe('true')
    expect(quiet.context.place).toBeUndefined()
  })
})
