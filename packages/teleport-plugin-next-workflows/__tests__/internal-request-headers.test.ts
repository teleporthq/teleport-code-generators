import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { nodeRegistry } from '../src/nodes'
import type { WorkflowSegment } from '../src/types'

/**
 * A generated app's data nodes reach the database by having the server call its
 * OWN `/api/data/<id>/<op>` route over HTTP. On a deployment behind Vercel
 * Deployment Protection that self-call is answered with 401 "Protected
 * deployment" — the page still renders (the visitor's browser holds the bypass
 * cookie) but every data node returns `{ rows: [] }`, so the app looks alive
 * while nothing reads or writes.
 *
 * Measured on a published AI-chat store: all four RAG queries came back empty
 * with `error: { message: 'Protected deployment', code: '401' }`, and the
 * assistant answered "I don't have enough information in my knowledge base" to
 * every question — with a fully populated knowledge base sitting in the
 * database.
 */

function loadRuntime() {
  const source = generateSharedRuntimeUtilsCode()
  const fn = source.match(/function internalRequestHeaders[\s\S]*?\n\}/)
  if (!fn) {
    throw new Error('internalRequestHeaders not found in the generated runtime')
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return {
    internalRequestHeaders: new Function(`${fn[0]}\nreturn internalRequestHeaders;`)() as (
      req: unknown
    ) => Record<string, string>,
  }
}

describe('internalRequestHeaders', () => {
  const utils = loadRuntime()
  const originalBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

  afterEach(() => {
    if (originalBypass === undefined) {
      delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    } else {
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET = originalBypass
    }
  })

  it('forwards the caller cookie that already passed the protection', () => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    const headers = utils.internalRequestHeaders({
      headers: { cookie: '_vercel_jwt=abc; next-auth.session-token=xyz' },
    })
    expect(headers.cookie).toBe('_vercel_jwt=abc; next-auth.session-token=xyz')
  })

  it('sends the automation bypass secret when the project configured one', () => {
    // The only credential available when no browser sits behind the request.
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'sekret'
    const headers = utils.internalRequestHeaders({ headers: {} })
    expect(headers['x-vercel-protection-bypass']).toBe('sekret')
    expect(headers['x-vercel-set-bypass-cookie']).toBe('false')
  })

  it('returns an empty object rather than throwing on a request with no headers', () => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    expect(utils.internalRequestHeaders(undefined)).toEqual({})
    expect(utils.internalRequestHeaders({})).toEqual({})
  })

  it('invents no cookie when the caller sent none', () => {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    expect(utils.internalRequestHeaders({ headers: {} }).cookie).toBeUndefined()
  })
})

describe('every data node forwards the internal headers on its self-call', () => {
  const DATA_NODES = [
    'data-raw-query',
    'data-select',
    'data-count',
    'data-create-item',
    'data-update-item',
    'data-delete-item',
  ]

  it.each(DATA_NODES)('%s reads context.__internalHeaders', (nodeType) => {
    const source = nodeRegistry[nodeType].generateHandler()
    expect(source).toContain('context.__internalHeaders')
  })

  it.each(DATA_NODES)('%s merges them into every self-call it makes', (nodeType) => {
    const source = nodeRegistry[nodeType].generateHandler()
    // A bare `headers: { 'Content-Type': … }` on a call to this deployment's own
    // API is the shape that 401s; every one must be an Object.assign that folds
    // the internal headers in.
    const selfCalls = source.split('fetch(baseUrl').slice(1)
    expect(selfCalls.length).toBeGreaterThan(0)
    for (const call of selfCalls) {
      const headersAt = call.indexOf('headers:')
      expect(headersAt).toBeGreaterThan(-1)
      expect(call.slice(headersAt, headersAt + 60)).toContain('Object.assign')
    }
  })
})

describe('the segment routes supply the headers but never echo them back', () => {
  const segment: WorkflowSegment = {
    id: 'seg-server-1',
    workflowId: 'wf-1',
    executionEnv: 'server',
    nodes: [
      {
        id: 'n1',
        type: 'data-raw-query',
        config: { dataSourceId: 'ds-1', query: 'SELECT 1' },
        stepNumber: 1,
        label: 'Probe',
      },
    ],
    edges: [],
  } as unknown as WorkflowSegment

  const routes = [
    ['non-streaming', generateServerSegmentAPIRoute(segment)],
    ['streaming', generateStreamingServerSegmentAPIRoute(segment)],
  ] as const

  it.each(routes)('%s route puts the headers on the execution context', (_label, route) => {
    expect(route).toContain('context.__internalHeaders = utils.internalRequestHeaders(req)')
  })

  it.each(routes)('%s route deletes them before serializing the context', (_label, route) => {
    // ⛔ `results` in the response IS this context. The forwarded cookie carries
    // the visitor's session token; writing it into a JS-readable response body
    // would undo the httpOnly flag it was set with.
    const deleteAt = route.indexOf('delete context.__internalHeaders')
    expect(deleteAt).toBeGreaterThan(-1)
    const firstEcho = route.indexOf('results: context')
    expect(firstEcho).toBeGreaterThan(-1)
    expect(deleteAt).toBeLessThan(firstEcho)
  })

  it.each(routes)('%s route echoes the context exactly once per exit path', (_label, route) => {
    // Guards the assertion above: a second `results: context` added later would
    // sit outside the delete's reach unless it is also after it.
    const positions: number[] = []
    let idx = route.indexOf('results: context')
    while (idx !== -1) {
      positions.push(idx)
      idx = route.indexOf('results: context', idx + 1)
    }
    const deleteAt = route.indexOf('delete context.__internalHeaders')
    for (const position of positions) {
      expect(position).toBeGreaterThan(deleteAt)
    }
  })
})
