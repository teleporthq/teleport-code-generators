import * as nodeCrypto from 'crypto'
import * as net from 'net'
import {
  COST_BEARING_STEP_LIMITS,
  SEGMENT_PUBLIC_ERROR,
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  isCostBearingNodeType,
} from '../src/api-route-generator'
import { generateSecurityRuntimeCode } from '../src/security-runtime'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// A server segment that spends the site's money (an AI model, a mail or SMS
// provider, a payment provider, another site) is a public route: these run
// the GENERATED route with the real shared security runtime (no database here,
// so it counts per instance) and check every visitor is limited whatever the
// page's protection, and that what a visitor sees of a failure is generic.

interface RouteReply {
  status: number
  headers: Record<string, string>
  body: any
  written: string[]
}

const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'abuse-gate-test-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

function loadSecurityRuntime(log: { warn: jest.Mock; error: jest.Mock }) {
  const requireShim = (id: string): unknown => {
    if (id === 'crypto') {
      return nodeCrypto
    }
    if (id === 'net') {
      return net
    }
    throw new Error("Cannot find module '" + id + "'")
  }
  const module = { exports: {} as any }
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
  )(module, module.exports, requireShim, { env: {} }, log, Buffer, Date)
  return module.exports
}

function bootRoute(source: string) {
  const log = { warn: jest.fn(), error: jest.fn() }
  const runtime = loadServerRuntime()
  const security = loadSecurityRuntime(log)
  const requireStub = (id: string) => {
    if (id.endsWith('server-runtime')) {
      return runtime
    }
    if (id.endsWith('security-runtime')) {
      return security
    }
    return {}
  }
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', 'console', source)(
    routeModule,
    routeModule.exports,
    requireStub,
    log
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  const call = async (
    context: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<RouteReply> => {
    const reply: RouteReply = { status: 0, headers: {}, body: null, written: [] }
    const res = {
      setHeader(name: string, value: string) {
        reply.headers[name] = value
      },
      status(code: number) {
        reply.status = code
        return this
      },
      json(payload: unknown) {
        reply.body = payload
        return this
      },
      writeHead(code: number) {
        reply.status = code
      },
      write(chunk: string) {
        reply.written.push(chunk)
      },
      end: (): undefined => undefined,
    }
    await handler(
      {
        method: 'POST',
        body: { context },
        headers: { host: 'localhost:3000', ...headers },
        socket: { remoteAddress: '203.0.113.7' },
      },
      res
    )
    return reply
  }
  return { call, log, runtime }
}

const segmentOf = (nodes: any[]): WorkflowSegment => ({
  id: 'server-1',
  env: 'server',
  nodeIds: nodes.map((n) => n.id),
  nodes,
  edges: [],
  entryNodeIds: nodes.map((n) => n.id),
})

const aiNode = {
  id: 'ask',
  type: 'ai-custom-prompt',
  label: 'Ask The Model',
  stepNumber: 1,
  config: {
    prompt: 'Summarize',
    token: { type: 'dynamic', content: { referenceType: 'secret', id: 'AI_OPENAI_TOKEN' } },
  },
}

const scriptNode = (id: string, body: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'general-custom-js',
  label: id,
  stepNumber: 1,
  config: { code: `function customHandler(params) { ${body} }`, context: 'server', ...extra },
})

// The AI step is marked skipped where it enters the segment: the gate counts
// the request before any node runs, so the model is never called here.
const skipAsk = { __skippedNodes: { ask: true } }

describe('the abuse gate of a segment that spends money', () => {
  it('names the cost-bearing and outbound node types', () => {
    for (const type of [
      'ai-custom-prompt',
      'email-resend',
      'sms-twilio',
      'payment-charge-user',
      'integration-slack',
      'general-http-request',
      'utility-scrape-website',
    ]) {
      expect(isCostBearingNodeType(type)).toBe(true)
    }
    for (const type of ['general-custom-js', 'data-select', 'general-if-statement']) {
      expect(isCostBearingNodeType(type)).toBe(false)
    }
  })

  it('answers 429 to a visitor past the minute allowance, on a route no page protects', async () => {
    const { call } = bootRoute(generateServerSegmentAPIRoute(segmentOf([aiNode]), 'Ask'))
    for (let i = 0; i < COST_BEARING_STEP_LIMITS.perMinute; i++) {
      expect((await call(skipAsk)).status).toBe(200)
    }
    const refused = await call(skipAsk)
    expect(refused.status).toBe(429)
    expect(refused.body).toEqual({ error: 'Too many requests. Try again later.' })
    expect(Number(refused.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('limits the streaming route the same way', async () => {
    const { call } = bootRoute(generateStreamingServerSegmentAPIRoute(segmentOf([aiNode]), 'Ask'))
    for (let i = 0; i < COST_BEARING_STEP_LIMITS.perMinute; i++) {
      await call(skipAsk)
    }
    expect((await call(skipAsk)).status).toBe(429)
  })

  it("does not count this deployment's own server code", async () => {
    const { call, runtime } = bootRoute(generateServerSegmentAPIRoute(segmentOf([aiNode]), 'Ask'))
    const internal = runtime.internalRequestHeaders({ headers: {} })
    for (let i = 0; i < COST_BEARING_STEP_LIMITS.perMinute + 5; i++) {
      expect((await call(skipAsk, internal)).status).toBe(200)
    }
  })

  it('leaves a segment that spends nothing unlimited', async () => {
    const { call } = bootRoute(
      generateServerSegmentAPIRoute(segmentOf([scriptNode('calc', 'return { ok: true }')]), 'Calc')
    )
    for (let i = 0; i < COST_BEARING_STEP_LIMITS.perMinute + 5; i++) {
      expect((await call({})).status).toBe(200)
    }
  })
})

describe('what a visitor sees of a failed step', () => {
  const failing = scriptNode(
    'boom',
    "throw new Error('Secret not found: AI_OPENAI_TOKEN (select * from users)')"
  )

  it('is a generic error and an id; the detail goes to the server log under that id', async () => {
    const { call, log } = bootRoute(generateServerSegmentAPIRoute(segmentOf([failing]), 'Fails'))
    const reply = await call({})
    expect(reply.status).toBe(500)
    expect(reply.body).toEqual({
      error: SEGMENT_PUBLIC_ERROR,
      id: expect.stringMatching(/^[0-9a-f]{16}$/),
    })
    const text = JSON.stringify(reply.body)
    expect(text).not.toMatch(/AI_OPENAI_TOKEN|Secret not found|select|at Object|\.js:/)
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining(reply.body.id),
      expect.objectContaining({ message: expect.stringContaining('AI_OPENAI_TOKEN') })
    )
  })

  it('is generic on the streaming route too', async () => {
    const { call } = bootRoute(
      generateStreamingServerSegmentAPIRoute(segmentOf([failing]), 'Fails')
    )
    const reply = await call({})
    expect(reply.status).toBe(500)
    expect(reply.body.error).toBe(SEGMENT_PUBLIC_ERROR)
    expect(JSON.stringify(reply.body)).not.toContain('AI_OPENAI_TOKEN')
  })

  it('never names an env var the segment references, even in a result it hands back', async () => {
    const quoting = scriptNode(
      'quote',
      "return { error: true, message: 'Secret not found: AI_OPENAI_TOKEN' }",
      {
        continueOnError: true,
        params: {
          key: { type: 'dynamic', content: { referenceType: 'secret', id: 'AI_OPENAI_TOKEN' } },
        },
      }
    )
    const { call } = bootRoute(generateServerSegmentAPIRoute(segmentOf([quoting]), 'Quotes'))
    const reply = await call({})
    expect(reply.status).toBe(200)
    expect(reply.body.results.quote.message).toBe('Secret not found: [secret]')
    expect(JSON.stringify(reply.body)).not.toContain('AI_OPENAI_TOKEN')
  })
})

describe('the abuse gate also counts what a server-run custom node spends', () => {
  const callNode = {
    id: 'record',
    type: 'general-custom-node',
    label: 'Ask Through A Custom Node',
    stepNumber: 1,
    executionEnv: 'server',
    config: { customNodeId: 'cn-ask', parameters: [] },
  }
  const customNodes = {
    'cn-ask': { id: 'cn-ask', name: 'Ask', nodes: [aiNode], edges: [] },
  } as any

  it('gates a segment whose custom node runs an AI step, under its own scope prefix', () => {
    const gated = generateServerSegmentAPIRoute(segmentOf([callNode]), 'Ask', undefined, {
      customNodes,
    })
    expect(gated).toContain('rateLimitRequest')
    expect(gated).toContain('"workflow-route:Ask:server-1"')
    const plain = generateServerSegmentAPIRoute(segmentOf([callNode]), 'Ask', undefined, {
      customNodes: {
        'cn-ask': { ...customNodes['cn-ask'], nodes: [scriptNode('calc', 'return 1')] },
      },
    })
    expect(plain).not.toContain('rateLimitRequest')
  })
})

describe('the secret-name scrub', () => {
  it('replaces a referenced name only as a whole word', async () => {
    const quoting = scriptNode(
      'quote',
      "return { a: 'Secret not found: AI_OPENAI_TOKEN', b: 'MY_AI_OPENAI_TOKEN_2 and xAI_OPENAI_TOKEN stay' }",
      {
        params: {
          key: { type: 'dynamic', content: { referenceType: 'secret', id: 'AI_OPENAI_TOKEN' } },
        },
      }
    )
    const { call } = bootRoute(generateServerSegmentAPIRoute(segmentOf([quoting]), 'Quotes'))
    const reply = await call({})
    expect(reply.body.results.quote).toEqual({
      a: 'Secret not found: [secret]',
      b: 'MY_AI_OPENAI_TOKEN_2 and xAI_OPENAI_TOKEN stay',
    })
  })
})
