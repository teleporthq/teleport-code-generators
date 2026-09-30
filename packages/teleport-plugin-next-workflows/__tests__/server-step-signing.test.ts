import { generateServerSegmentAPIRoute } from '../src'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// The results of every server segment reach the next one through the caller
// (the browser relays them), so each segment signs what it produced and the
// next one only acts on what carries a valid signature. These run the
// GENERATED routes of one workflow — guard → browser step → write — against
// honest hand-offs and forged ones.

interface RouteReply {
  status: number
  body: { success: boolean; results?: Record<string, any>; error?: string }
}

type Context = Record<string, unknown>

const runtime = loadServerRuntime()

// Every generated app carries an app secret (the project plugin writes one).
const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'step-signing-test-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

const script = (body: string) => `function customHandler(params) { ${body} }`

const workflow = {
  nodes: [
    {
      id: 'check',
      type: 'general-custom-js',
      label: 'Check Token',
      stepNumber: 1,
      config: {
        context: 'server',
        code: script(
          'var t = params[0] || {}; var ok = t.token === "good"; return { ok: ok, email: ok ? "owner@shop.test" : "" }'
        ),
      },
    },
    {
      id: 'gate',
      type: 'general-if-statement',
      label: 'Is The Token Valid?',
      stepNumber: 2,
      config: {
        conditionType: 'simple-comparison',
        leftValue: { type: 'workflowContext', nodeId: 'check', path: ['check', 'ok'] },
        operator: '===',
        rightValue: true,
      },
    },
    {
      id: 'ui',
      type: 'state-update-local-state',
      label: 'Show Progress',
      stepNumber: 3,
      config: { property: 'busy', value: true },
    },
    {
      id: 'write',
      type: 'general-custom-js',
      label: 'Write Password',
      stepNumber: 4,
      config: {
        context: 'server',
        code: script('var named = params[params.length - 1] || {}; return { wrote: named.email }'),
        params: { email: { type: 'workflowContext', nodeId: 'check', path: ['check', 'email'] } },
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'check', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'ui', sourceHandle: 'true' },
    { id: 'e3', source: 'ui', target: 'write' },
  ],
  trigger: { type: 'event-element-clicked' },
} as any

const segments = splitIntoSegments(workflow)
const serverSegments = segments.filter((s) => s.env === 'server')

function bootRoute(segment: WorkflowSegment) {
  const source = generateServerSegmentAPIRoute(segment, 'Signing', undefined, {
    trust: buildSegmentTrust(segment, { nodes: workflow.nodes, edges: workflow.edges, segments }),
  })
  const routeModule: { exports: unknown } = { exports: {} }
  const requireStub = (id: string) => (id.endsWith('server-runtime') ? runtime : {})
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    requireStub
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  return async (context: Context): Promise<RouteReply> => {
    const reply: RouteReply = { status: 0, body: { success: false } }
    const res = {
      status(code: number) {
        reply.status = code
        return this
      },
      json(payload: RouteReply['body']) {
        reply.body = payload
        return this
      },
    }
    await handler(
      {
        method: 'POST',
        body: { context: JSON.parse(JSON.stringify(context)) },
        headers: { host: 'localhost:3000' },
      },
      res
    )
    return reply
  }
}

const guardRoute = bootRoute(serverSegments[0])
const writeRoute = bootRoute(serverSegments[1])

/** The caller's side of a hop: merge the reply the way the client runtime does. */
function merge(context: Context, results: Record<string, unknown> = {}): Context {
  const next = { ...context }
  for (const key of Object.keys(results)) {
    next[key] = results[key]
  }
  return next
}

async function honestRun(token: string): Promise<{ afterGuard: Context; write: RouteReply }> {
  const start: Context = { trigger: { token } }
  const guard = await guardRoute(start)
  const afterGuard = merge(start, guard.body.results)
  const beforeWrite = merge(afterGuard, { ui: { updated: true } })
  return { afterGuard, write: await writeRoute(beforeWrite) }
}

describe('signed hand-off between server segments', () => {
  it('splits the workflow into a guard segment and a write segment', () => {
    expect(segments.map((s) => s.env)).toEqual(['server', 'client', 'server'])
    expect(serverSegments[0].nodes.map((n) => n.id)).toEqual(['check', 'gate'])
    expect(serverSegments[1].nodes.map((n) => n.id)).toEqual(['write'])
  })

  it('writes what the guard allowed on an honest run', async () => {
    const { afterGuard, write } = await honestRun('good')
    expect(Object.keys(afterGuard.__sig as object).sort()).toEqual(['check', 'gate'])
    expect(write.status).toBe(200)
    expect(write.body.results?.write).toEqual({ wrote: 'owner@shop.test' })
  })

  it('skips the write when the guard refused, on an honest run', async () => {
    const { write } = await honestRun('bad')
    expect(write.body.results?.write).toBeUndefined()
    expect(write.body.results?.__skippedNodes).toMatchObject({ write: true })
  })

  it('ignores a forged verdict with no signature — the gated write does not run', async () => {
    const reply = await writeRoute({
      trigger: { token: 'bad' },
      check: { ok: true, email: 'victim@shop.test' },
      gate: { result: true },
      ui: {},
    })
    expect(reply.status).toBe(200)
    expect(reply.body.results?.write).toBeUndefined()
  })

  it('ignores a signed verdict someone edited', async () => {
    const { afterGuard } = await honestRun('good')
    const forged = merge(afterGuard, {
      check: { ok: true, email: 'victim@shop.test' },
      ui: {},
    })
    const reply = await writeRoute(forged)
    // The guard's own decision still holds, but the edited email no longer
    // carries a valid signature, so the write reads nothing.
    expect(reply.body.results?.write).toEqual({})
  })

  it('does not run a write whose guard never ran', async () => {
    const reply = await writeRoute({ trigger: { token: 'good' }, ui: {} })
    expect(reply.body.results?.write).toBeUndefined()
  })

  it('drops a signed result the signed key order does not list (a stale order)', async () => {
    const { afterGuard } = await honestRun('good')
    const stale = {
      ...afterGuard,
      __sigOrder: runtime.segmentReply({ nodes: [] }, { trigger: {} }, {}).__sigOrder,
      ui: {},
    }
    const reply = await writeRoute(stale)
    expect(reply.body.results?.write).toBeUndefined()
  })

  it('signs the key order the caller will hold, appending what the run added', async () => {
    const { afterGuard } = await honestRun('good')
    expect((afterGuard.__sigOrder as { keys: string[] }).keys).toEqual(['trigger', 'check', 'gate'])
  })
})

describe('claimSegmentContext — what a request cannot carry', () => {
  const plainConfig = {
    nodes: [{ id: 'n', type: 'general-custom-js' }],
    edges: [],
    entryNodeIds: ['n'],
  }

  it('drops custom-node bookkeeping outside a custom node segment', () => {
    const context: Context = {
      __isInsideCustomNode: true,
      __customNodeIds: ['x'],
      __customParams: { orderId: 'o1' },
    }
    runtime.claimSegmentContext(plainConfig, context)
    expect(context.__isInsideCustomNode).toBeUndefined()
    expect(context.__customNodeIds).toBeUndefined()
    expect(context.__customParams).toBeUndefined()
  })

  it('keeps only real loops and their real body nodes in the loop scope', () => {
    const context: Context = {
      __loopNodeIds: { loop: true, fake: true },
      __loopScopeStack: [
        { loopNodeId: 'loop', bodyNodeIds: { body: true, price: true } },
        { loopNodeId: 'fake', bodyNodeIds: { price: true } },
      ],
    }
    runtime.claimSegmentContext({ ...plainConfig, loopBodies: { loop: ['body'] } }, context)
    expect(context.__loopNodeIds).toEqual({ loop: true })
    expect(context.__loopScopeStack).toEqual([{ loopNodeId: 'loop', bodyNodeIds: { body: true } }])
  })

  it('takes the previous result from the signed result of the server node that ran just before', () => {
    const signed = runtime.segmentReply(
      { nodes: [{ id: 'before' }] },
      { before: { rows: [{ email: 'owner@shop.test' }] } },
      {}
    )
    const context: Context = {
      ...JSON.parse(JSON.stringify(signed)),
      __previousNodeResult: { rows: [{ email: 'victim@shop.test' }] },
    }
    runtime.claimSegmentContext(
      {
        ...plainConfig,
        signedNodeIds: ['before'],
        previousFrom: { nodeId: 'before', fireAndForget: false },
      },
      context
    )
    expect(context.__previousNodeResult).toEqual({ rows: [{ email: 'owner@shop.test' }] })
  })

  it('hands an empty previous result on when that node has no valid signature', () => {
    const context: Context = {
      before: { rows: [{ email: 'victim@shop.test' }] },
      __previousNodeResult: { rows: [{ email: 'victim@shop.test' }] },
    }
    runtime.claimSegmentContext(
      {
        ...plainConfig,
        signedNodeIds: ['before'],
        previousFrom: { nodeId: 'before', fireAndForget: false },
      },
      context
    )
    expect(context.before).toBeUndefined()
    expect(context.__previousNodeResult).toEqual({})
  })

  it('skips every branch of a switch whose decision is missing', () => {
    const context: Context = {}
    runtime.claimSegmentContext(
      {
        ...plainConfig,
        branchGates: [
          {
            id: 'sw',
            kind: 'switch',
            branches: [
              { when: 'case:a', nodeIds: ['n'] },
              { when: 'default', nodeIds: ['m'] },
            ],
          },
        ],
      },
      context
    )
    expect(context.__skippedNodes).toMatchObject({ n: true, m: true })
  })
})

describe("internal calls between this deployment's own routes", () => {
  it('accepts the token its own headers carry and nothing else', () => {
    const headers = runtime.internalRequestHeaders({ headers: {} })
    expect(runtime.isInternalCall({ headers })).toBe(true)
    expect(runtime.isInternalCall({ headers: { 'x-teleport-internal': 'forged' } })).toBe(false)
    expect(runtime.isInternalCall({ headers: {} })).toBe(false)
  })
})

describe('an app with no secret', () => {
  // Keyed from '' every signature and token would be a value anyone can
  // compute, so nothing verifies: relayed results are dropped, no request is
  // an internal call.
  const withoutSecret = async <T>(run: () => Promise<T> | T): Promise<T> => {
    const secret = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    try {
      return await run()
    } finally {
      process.env.NEXTAUTH_SECRET = secret
    }
  }

  it('acts on no relayed result, not even its own', async () => {
    const { write } = await withoutSecret(() => honestRun('good'))
    expect(write.body.results?.write).toBeUndefined()
  })

  it('takes no request for an internal call', async () => {
    await withoutSecret(() => {
      const headers = runtime.internalRequestHeaders({ headers: {} })
      expect(runtime.isInternalCall({ headers })).toBe(false)
    })
  })
})

describe('trustedBaseUrl', () => {
  const env = process.env
  afterEach(() => {
    process.env = env
  })

  it('never calls a host the request named when the canonical origin is configured', () => {
    process.env = { ...env, NEXTAUTH_URL: 'https://shop.example', VERCEL: '' }
    expect(runtime.trustedBaseUrl({ headers: { host: 'evil.example' } })).toBe(
      'https://shop.example'
    )
  })

  it('keeps a local server on its own port', () => {
    process.env = { ...env, NEXTAUTH_URL: 'http://localhost:3000', VERCEL: '' }
    expect(runtime.trustedBaseUrl({ headers: { host: 'localhost:3001' } })).toBe(
      'http://localhost:3001'
    )
  })

  it('uses the host Vercel routed the request to', () => {
    process.env = { ...env, NEXTAUTH_URL: 'https://shop.example', VERCEL: '1' }
    expect(
      runtime.trustedBaseUrl({
        headers: { host: 'preview.vercel.app', 'x-forwarded-proto': 'https' },
      })
    ).toBe('https://preview.vercel.app')
  })
})
