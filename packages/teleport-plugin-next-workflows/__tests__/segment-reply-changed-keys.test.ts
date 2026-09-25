import { generateSharedRuntimeUtilsCode, generateServerSegmentAPIRoute } from '../src'
import type { WorkflowSegment } from '../src/types'

// A server segment used to reply with its whole context: every earlier node's
// result, the trigger, the page state the browser had just sent — so each
// round trip carried the page back to the browser and the network tab showed
// every node's data on every hop. The reply now carries what the run produced
// or changed. These run the GENERATED route and read its reply.

interface RouteReply {
  status: number
  body: { success: boolean; results?: Record<string, unknown>; error?: string }
}

function loadSharedRuntime(): Record<string, unknown> {
  const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports
  )
  return utilsModule.exports
}

function bootRoute(workflowSegment: WorkflowSegment) {
  const source = generateServerSegmentAPIRoute(workflowSegment, 'Reply')
  const utils = loadSharedRuntime()
  const requireStub = (id: string) => (id.endsWith('server-runtime') ? utils : {})
  const routeModule: { exports: unknown } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    requireStub
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  return async (context: Record<string, unknown>): Promise<RouteReply> => {
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
    await handler({ method: 'POST', body: { context }, headers: { host: 'localhost:3000' } }, res)
    return reply
  }
}

const script = (body: string) => `function customHandler(params) { ${body} }`

const calcNode = {
  id: 'calc',
  type: 'general-custom-js',
  label: 'Calc',
  executionEnv: 'server' as const,
  stepNumber: 1,
  config: { code: script('return { total: 42 }'), context: 'server' },
}
const gateNode = {
  id: 'gate',
  type: 'general-if-statement',
  label: 'Gate',
  executionEnv: 'server' as const,
  stepNumber: 2,
  config: {
    conditionType: 'simple-comparison',
    leftValue: { type: 'workflowContext', nodeId: 'calc', path: ['calc', 'total'] },
    operator: '>',
    rightValue: 100,
  },
}
const bigNode = {
  id: 'big',
  type: 'general-custom-js',
  label: 'Big',
  executionEnv: 'server' as const,
  stepNumber: 3,
  config: { code: script('return { big: true }'), context: 'server' },
}
const segment: WorkflowSegment = {
  id: 'server-1',
  env: 'server',
  nodeIds: ['calc', 'gate', 'big'],
  nodes: [calcNode, gateNode, bigNode],
  edges: [
    { id: 'e1', source: 'calc', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'big', sourceHandle: 'true' },
  ] as WorkflowSegment['edges'],
  entryNodeIds: ['calc'],
}

const request = () => ({
  trigger: { formData: { code: 'SAVE10' }, __stateValues: { countryCode: 'RO' } },
  __stateValues: { countryCode: 'RO', countries: [{ value: 'RO' }] },
  __locale: 'en',
  earlier: { rows: [{ id: 1 }] },
})

describe('generated server segment — what it replies with', () => {
  it('replies with its own results and the branch marks, not with what the caller sent', async () => {
    const reply = await bootRoute(segment)(request())
    expect(reply.status).toBe(200)
    const results = reply.body.results || {}
    expect(results.calc).toEqual({ total: 42 })
    expect(results.gate).toEqual({ result: false })
    // The gate closed the branch: the client learns that from the marks.
    expect(results.__skippedNodes).toEqual({ big: true })
    expect(results).not.toHaveProperty('big')
    // Echoes of the request are gone: the page state, the trigger, earlier
    // results, the locale the caller already knows.
    expect(results).not.toHaveProperty('__stateValues')
    expect(results).not.toHaveProperty('trigger')
    expect(results).not.toHaveProperty('earlier')
    expect(results).not.toHaveProperty('__internalHeaders')
    expect(results).not.toHaveProperty('__pendingNodePromises')
  })

  it('still replies with what the route itself adds to the run', async () => {
    const results = (await bootRoute(segment)(request())).body.results || {}
    // The route learns the deployment's origin; a custom node called next
    // reads it off the context.
    expect(results.__baseUrl).toBe('http://localhost:3000')
  })

  it('replies with a locale the caller did not carry', async () => {
    const { __locale, ...withoutLocale } = request()
    void __locale
    const results = (await bootRoute(segment)(withoutLocale)).body.results || {}
    expect(typeof results.__locale).toBe('string')
  })

  it('replies with its own node result even when the caller sent the same value', async () => {
    // A loop body re-run: the browser carries the previous iteration's result
    // for the same node id, the run produces an identical one, and the client
    // still resets __previousNodeResult from the reply.
    const results =
      (await bootRoute(segment)({ ...request(), calc: { total: 42 } })).body.results || {}
    expect(results.calc).toEqual({ total: 42 })
  })

  it('replies with a key the run changed in place', async () => {
    const results =
      (await bootRoute(segment)({ ...request(), __skippedNodes: { stale: true } })).body.results ||
      {}
    // claimSegmentContext drops marks for ids the segment does not own only
    // when they are inside it; a foreign stale mark survives, and the segment's
    // own closed branch joins it: the object changed, so it is replied.
    expect(results.__skippedNodes).toEqual({ stale: true, big: true })
  })
})
