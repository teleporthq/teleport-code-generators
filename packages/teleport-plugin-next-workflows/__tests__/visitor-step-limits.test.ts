import * as crypto from 'crypto'
import * as net from 'net'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { generateSecurityRuntimeCode } from '../src/security-runtime'
import {
  buildVisitorStepLimitGuard,
  collectVisitorStepLimits,
  readVisitorStepLimit,
} from '../src/visitor-step-limits'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// A guest booking and a newsletter signup are steps any visitor may run — but
// not without end. The feature that builds the step declares a per-visitor
// limit on it; the segment route counts it in the shared security runtime
// before any step runs.

const ifNode = (id: string, stepNumber: number, config: Record<string, unknown> = {}) => ({
  id,
  type: 'general-if-statement',
  label: id,
  config: {
    conditionType: 'simple-comparison',
    leftValue: 'yes',
    operator: '===',
    rightValue: 'yes',
    ...config,
  },
  executionEnv: 'server',
  stepNumber,
})

const segmentWith = (visitorLimit?: unknown): WorkflowSegment =>
  ({
    id: 'server-1',
    env: 'server',
    nodeIds: ['write', 'after'],
    nodes: [
      ifNode('write', 1, visitorLimit === undefined ? {} : { visitorLimit }),
      ifNode('after', 2),
    ],
    edges: [{ id: 'e1', source: 'write', target: 'after', sourceHandle: 'true' }],
  } as unknown as WorkflowSegment)

/** One instance of the generated app: its server runtime and its security runtime (no database). */
const loadApp = () => {
  const serverRuntime = loadServerRuntime()
  const security = { exports: {} as any }
  const noop = (): undefined => undefined
  const quiet = { warn: noop, error: noop, log: noop }
  // eslint-disable-next-line no-new-func
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
    (id: string) => {
      if (id === 'crypto') {
        return crypto
      }
      if (id === 'net') {
        return net
      }
      throw new Error("Cannot find module '" + id + "'")
    },
    { env: {} },
    quiet,
    Buffer,
    Date
  )
  const requireShim = (id: string) => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return serverRuntime
    }
    if (id.endsWith('/utils/security-runtime')) {
      return security.exports
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const route = (source: string) => {
    const module = { exports: null as any }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', source)(module, {}, requireShim)
    return module.exports
  }
  return { serverRuntime, route }
}

const call = async (
  handler: (req: unknown, res: unknown) => Promise<void>,
  headers: Record<string, string> = {}
) => {
  const reply = { status: 0, body: null as any, headers: {} as Record<string, string> }
  // Shaped like a Next.js API response: status() and json() chain.
  const res: Record<string, unknown> = {
    headersSent: false,
    status(code: number): unknown {
      reply.status = code
      return res
    },
    json(payload: unknown): unknown {
      reply.body = payload
      return res
    },
    setHeader: (name: string, value: string) => {
      reply.headers[name] = value
    },
  }
  await handler(
    {
      method: 'POST',
      url: '/api/workflows/book-seg-1',
      headers: { host: 'shop.test', 'x-forwarded-proto': 'https', ...headers },
      socket: { remoteAddress: '203.0.113.7' },
      body: { context: {} },
    },
    res
  )
  return reply
}

describe('a step that declares a per-visitor limit', () => {
  const previousSecret = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'test-app-secret'
  })
  afterAll(() => {
    process.env.NEXTAUTH_SECRET = previousSecret
  })
  beforeEach(() => {
    delete (globalThis as any).__tqStepLimitSkipLog
  })

  it('answers 429 once the visitor is past it, before any step runs', async () => {
    const app = loadApp()
    const handler = app.route(
      generateServerSegmentAPIRoute(segmentWith({ limit: 2, windowSeconds: 3600 }), 'Book')
    )
    const first = await call(handler)
    expect(first.status).toBe(200)
    expect(first.body.results.write).toEqual({ result: true })
    expect((await call(handler)).status).toBe(200)
    const third = await call(handler)
    expect(third.status).toBe(429)
    expect(third.body).toEqual({ error: 'Too many requests. Try again later.' })
    expect(Number(third.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('never counts this deployment’s own server code', async () => {
    const app = loadApp()
    const handler = app.route(
      generateServerSegmentAPIRoute(segmentWith({ limit: 1, windowSeconds: 3600 }), 'Book')
    )
    expect((await call(handler)).status).toBe(200)
    expect((await call(handler)).status).toBe(429)
    const internal = app.serverRuntime.internalRequestHeaders({ headers: {} })
    for (let i = 0; i < 3; i++) {
      expect((await call(handler, internal)).status).toBe(200)
    }
  })

  it("quietly skips the step and what follows it with onLimit 'skip'", async () => {
    const app = loadApp()
    const handler = app.route(
      generateServerSegmentAPIRoute(
        segmentWith({ limit: 1, windowSeconds: 3600, onLimit: 'skip' }),
        'Subscribe'
      )
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const first = await call(handler)
      expect(first.body.results.write).toEqual({ result: true })
      expect(warn).not.toHaveBeenCalled()
      const second = await call(handler)
      expect(second.status).toBe(200)
      expect(second.body.results).not.toHaveProperty('write')
      expect(second.body.results).not.toHaveProperty('after')
      expect(second.body.results.__skippedNodes).toMatchObject({ write: true, after: true })
      // Logged server-side, the scope only: never the visitor's address.
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toBe(
        '[workflow-step-limit] skipped past its visitor limit: workflow-step:write'
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('203.0.113.7')
    } finally {
      warn.mockRestore()
    }
  })

  it('logs at most one line per scope per minute, counting the rest into the next', async () => {
    const app = loadApp()
    const handler = app.route(
      generateServerSegmentAPIRoute(
        segmentWith({ limit: 1, windowSeconds: 3600, onLimit: 'skip', scope: 'newsletter-signup' }),
        'Subscribe'
      )
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const realNow = Date.now
    let now = realNow()
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      await call(handler)
      for (let i = 0; i < 4; i++) {
        await call(handler)
      }
      expect(warn).toHaveBeenCalledTimes(1)
      now += 61000
      await call(handler)
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[1][0])).toBe(
        '[workflow-step-limit] skipped past its visitor limit: visitor-limit:newsletter-signup (and 3 more since the last line)'
      )
    } finally {
      warn.mockRestore()
      clock.mockRestore()
    }
  })

  it('shares one budget between every step that names the same scope', async () => {
    const app = loadApp()
    const declared = { limit: 1, windowSeconds: 3600, scope: 'newsletter-signup' }
    const other = {
      ...segmentWith(declared),
      nodes: [ifNode('second-block', 1, { visitorLimit: declared })],
      edges: [] as unknown[],
    } as unknown as WorkflowSegment
    const first = app.route(generateServerSegmentAPIRoute(segmentWith(declared), 'Block A'))
    const second = app.route(generateServerSegmentAPIRoute(other, 'Block B'))
    expect((await call(first)).status).toBe(200)
    expect((await call(second)).status).toBe(429)
    expect(generateServerSegmentAPIRoute(other, 'Block B')).toContain(
      '"scope":"visitor-limit:newsletter-signup"'
    )
  })

  it('skips only an optional step (continueOnError) past its limit, never what follows it', () => {
    // A booking's newsletter tick: the subscribe step shares a segment with the
    // order checkout; past the visitor's budget the checkout must still run.
    const segment = {
      id: 'server-1',
      env: 'server',
      nodeIds: ['subscribe', 'read', 'charge'],
      nodes: [
        {
          id: 'subscribe',
          type: 'newsletter-subscribe',
          label: 'Join The Newsletter',
          config: { email: '', signUpPoint: 'booking', continueOnError: true },
          executionEnv: 'server',
          stepNumber: 1,
        },
        ifNode('read', 2),
        ifNode('charge', 3),
      ],
      edges: [
        { id: 'e1', source: 'subscribe', target: 'read' },
        { id: 'e2', source: 'read', target: 'charge' },
      ],
    } as unknown as WorkflowSegment
    const [limit] = collectVisitorStepLimits(segment)
    expect(limit).toMatchObject({ nodeId: 'subscribe', onLimit: 'skip', skipIds: ['subscribe'] })
    // Without continueOnError the step still takes what follows it along.
    const required = {
      ...segment,
      nodes: segment.nodes.map((node) =>
        node.id === 'subscribe' ? { ...node, config: { email: '', signUpPoint: 'booking' } } : node
      ),
    } as WorkflowSegment
    expect(collectVisitorStepLimits(required)[0].skipIds).toEqual(['subscribe', 'read', 'charge'])
  })

  it('is counted by the streaming segment route too', () => {
    const source = generateStreamingServerSegmentAPIRoute(
      segmentWith({ limit: 3, windowSeconds: 60 }),
      'Book'
    )
    expect(source).toContain('"scope":"workflow-step:write","limit":3,"windowSeconds":60')
    expect(source).toContain("require('../../../utils/security-runtime')")
  })

  it('leaves a route without a declared limit as it was', () => {
    const plain = segmentWith()
    expect(buildVisitorStepLimitGuard(plain)).toBe('')
    const source = generateServerSegmentAPIRoute(plain, 'Book')
    expect(source).not.toContain('workflow-step:')
    expect(source).not.toContain('__stepLimiter')
  })

  it('limits at the defaults when the declaration cannot be read', () => {
    expect(readVisitorStepLimit({ visitorLimit: true })).toEqual({
      limit: 10,
      windowSeconds: 3600,
      onLimit: 'refuse',
    })
    expect(readVisitorStepLimit({ visitorLimit: { limit: 0, windowSeconds: 'x' } })).toEqual({
      limit: 10,
      windowSeconds: 3600,
      onLimit: 'refuse',
    })
    expect(
      readVisitorStepLimit({ visitorLimit: { limit: 5, windowSeconds: 600, onLimit: 'skip' } })
    ).toEqual({ limit: 5, windowSeconds: 600, onLimit: 'skip' })
    expect(readVisitorStepLimit({})).toBeNull()
  })
})
