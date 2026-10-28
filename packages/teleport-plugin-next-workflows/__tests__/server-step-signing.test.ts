import { generateServerSegmentAPIRoute } from '../src'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { STEP_EXPIRED_MESSAGE } from '../src/server-runtime-code'

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

function bootRoute(segment: WorkflowSegment, graphId?: string) {
  const source = generateServerSegmentAPIRoute(segment, 'Signing', undefined, {
    trust: buildSegmentTrust(segment, {
      id: graphId,
      nodes: workflow.nodes,
      edges: workflow.edges,
      segments,
    }),
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

describe('signatures belong to one run of one workflow, for ten minutes', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('opens a new run at the first server segment, whatever run the request names', async () => {
    const { afterGuard } = await honestRun('good')
    const again = await guardRoute(afterGuard)
    expect((again.body.results?.__sigRun as { id: string }).id).not.toBe(
      (afterGuard.__sigRun as { id: string }).id
    )
  })

  it('refuses the results of one run handed on under another run', async () => {
    const { afterGuard: runA } = await honestRun('good')
    const { afterGuard: runB } = await honestRun('bad')
    // A's passed guard, presented as part of run B.
    const reply = await writeRoute({ ...runA, __sigRun: runB.__sigRun, ui: {} })
    expect(reply.body.results?.write).toBeUndefined()
    // B's own run, with A's verdict and signatures spliced in.
    const spliced = await writeRoute({
      ...runB,
      check: runA.check,
      gate: runA.gate,
      __sig: runA.__sig,
      ui: {},
    })
    expect(spliced.body.results?.write).toBeUndefined()
  })

  it('refuses a run the request made up', async () => {
    const { afterGuard } = await honestRun('good')
    const forgedRun = { id: 'a'.repeat(32), mac: (afterGuard.__sigRun as { mac: string }).mac }
    const reply = await writeRoute({ ...afterGuard, __sigRun: forgedRun, ui: {} })
    expect(reply.body.results?.write).toBeUndefined()
  })

  it('takes a result up to ten minutes old and refuses it after', async () => {
    const start = Date.now()
    const { afterGuard } = await honestRun('good')
    const later = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(start + ms)

    later(9 * 60 * 1000)
    const fresh = await writeRoute({ ...afterGuard, ui: {} })
    expect(fresh.body.results?.write).toEqual({ wrote: 'owner@shop.test' })

    later(10 * 60 * 1000 + 1000)
    const stale = await writeRoute({ ...afterGuard, ui: {} })
    expect(stale.body.results?.write).toBeUndefined()
    // Said, not silent: the visitor is told to start again.
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: STEP_EXPIRED_MESSAGE })
  })

  it('refuses a signature dated more than a minute ahead of the route, and takes clock skew below it', async () => {
    const start = Date.now()
    const { afterGuard } = await honestRun('good')
    jest.spyOn(Date, 'now').mockReturnValue(start - 30 * 1000)
    expect((await writeRoute({ ...afterGuard, ui: {} })).body.results?.write).toEqual({
      wrote: 'owner@shop.test',
    })
    jest.spyOn(Date, 'now').mockReturnValue(start - 2 * 60 * 1000)
    const ahead = await writeRoute({ ...afterGuard, ui: {} })
    expect(ahead.status).toBe(409)
    expect(ahead.body.results?.write).toBeUndefined()
  })

  it('refuses a result another workflow signed for the same node ids', async () => {
    const { afterGuard } = await honestRun('good')
    const otherWorkflowWrite = bootRoute(serverSegments[1], 'another-workflow')
    const reply = await otherWorkflowWrite({ ...afterGuard, ui: {} })
    expect(reply.body.results?.write).toBeUndefined()
  })
})

describe('claimSegmentContext — what a request cannot carry', () => {
  const plainConfig = {
    nodes: [{ id: 'n', type: 'general-custom-js' }],
    edges: [],
    entryNodeIds: ['n'],
  }

  it('drops a request-supplied __request (the route sets its own)', () => {
    const context: Context = { __request: { ip: '10.0.0.1', headers: { 'x-forged': '1' } } }
    runtime.claimSegmentContext(plainConfig, context)
    expect(context.__request).toBeUndefined()
  })

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
    delete (globalThis as Record<string, unknown>).__tqConfiguredNextAuthUrl
  })

  it('reads NEXTAUTH_URL as configured, never as the auth route rewrote it from a request', () => {
    const scope = globalThis as Record<string, unknown>
    // /api/auth keeps the configured value, then rewrites the live one from X-Forwarded-Host.
    process.env = { ...env, NEXTAUTH_URL: 'https://evil.example', VERCEL: '' }
    scope.__tqConfiguredNextAuthUrl = 'https://shop.example'
    expect(runtime.trustedBaseUrl({ headers: { host: 'evil.example' } })).toBe(
      'https://shop.example'
    )
    scope.__tqConfiguredNextAuthUrl = 'http://localhost:3000'
    expect(runtime.trustedBaseUrl({ headers: { host: 'evil.example' } })).toBe(
      'http://localhost:3000'
    )
    expect(runtime.trustedBaseUrl({ headers: { host: 'localhost:3001' } })).toBe(
      'http://localhost:3001'
    )
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
