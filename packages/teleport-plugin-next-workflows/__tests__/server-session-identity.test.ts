import { UIDLWorkflowProtection } from '@teleporthq/teleport-types'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import { generateWorkflowAuthHelperFile } from '../src/workflow-auth-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withFetch } from './_helpers/fake-fetch'

// Who the visitor is, inside a server segment, is the SESSION's user — never a
// value the browser posts. These run the GENERATED routes against requests
// that name someone else: a forged custom-node parameter (the subscription
// IDOR), a forged {{Current User.id}} page state, a forged current-user
// reader result, and the reserved session keys themselves.

interface RouteReply {
  status: number
  body: any
}

type Token = Record<string, unknown> | null

const getToken = async ({ req }: { req: any }) => (req && req.__token) || null

const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'session-identity-test-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

function bootGuard(runtime: Record<string, any>) {
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'next-auth/jwt') {
      return { getToken }
    }
    if (name === './server-runtime') {
      return runtime
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name)
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('require', 'module', 'exports', 'process', generateWorkflowAuthHelperFile())(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    process
  )
  return moduleObj.exports
}

function bootRoute(source: string) {
  const runtime = loadServerRuntime({ getToken })
  const guard = bootGuard(runtime)
  const requireStub = (id: string) => {
    if (id.endsWith('server-runtime')) {
      return runtime
    }
    if (id.endsWith('workflow-auth')) {
      return guard
    }
    return {}
  }
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    requireStub
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  return async (context: Record<string, unknown>, token: Token): Promise<RouteReply> => {
    const reply: RouteReply = { status: 0, body: null }
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
    await handler(
      {
        method: 'POST',
        body: { context: JSON.parse(JSON.stringify(context)) },
        // A signed-in local request carries the plain session cookie (the only
        // name read on http, see session-cookie-resolver).
        headers: token
          ? { host: 'localhost:3000', cookie: 'next-auth.session-token=signed' }
          : { host: 'localhost:3000' },
        __token: token,
      },
      res
    )
    return reply
  }
}

const ref = (nodeId: string, field: string) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, field],
})

const routeFor = (
  graph: { id: string; nodes: any[]; edges: any[] },
  protection?: UIDLWorkflowProtection,
  customNodeIds?: string[]
) => {
  const segments = splitIntoSegments({ ...graph, trigger: { type: 'manual' } } as any)
  const server = segments.find((s) => s.env === 'server') as WorkflowSegment
  return bootRoute(
    generateServerSegmentAPIRoute(server, graph.id, protection, {
      ...(customNodeIds ? { customNodeIds } : {}),
      trust: buildSegmentTrust(server, { ...graph, segments }),
    })
  )
}

const answerRows = () => ({ body: { rows: [] as unknown[], count: 0 } })

describe('a custom node segment acts on the session user, never on its parameters (A4-02)', () => {
  // The shape of the store's "Manage Subscription" node: a server step reads
  // the parameters the caller posts, and the next one scopes its read by the
  // user id and role the route binds to the session.
  const EXTRACT = [
    'function customHandler(previousContext, params) {',
    '  function text(value) { return value == null ? "" : String(value).trim(); }',
    '  return {',
    '    subscriptionId: text(params.subscriptionId),',
    '    action: text(params.action).toLowerCase(),',
    '    userId: text(params.userId),',
    '    anonymousUserId: text(params.anonymousUserId),',
    '    role: text(params.role)',
    '  };',
    '}',
  ].join('\n')
  const graph = {
    id: 'cn-manage-subscription',
    nodes: [
      {
        id: 'extract',
        type: 'general-custom-js',
        label: 'Extract Parameters',
        stepNumber: 1,
        config: { code: EXTRACT, context: 'server' },
      },
      {
        id: 'read',
        type: 'data-raw-query',
        label: 'Read Subscription Row',
        stepNumber: 2,
        config: {
          dataSourceId: 'ds-1',
          query: 'SELECT * FROM teleport_subscriptions WHERE id::text = $1 AND user_id::text = $2',
          params: [
            ref('extract', 'subscriptionId'),
            ref('extract', 'userId'),
            ref('extract', 'anonymousUserId'),
            ref('extract', 'role'),
          ],
          identityParams: [
            { index: 1, claim: 'signedInUserId' },
            { index: 3, claim: 'role' },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'extract', target: 'read' }],
  }
  const protection = {
    requiresAuth: true,
    allowedRoles: [],
    userScoped: {
      ownerColumn: 'user_id',
      bindings: [
        { nodeId: 'extract', path: ['userId'], claim: 'signedInUserId' },
        { nodeId: 'extract', path: ['role'], claim: 'role' },
      ],
    },
  } as unknown as UIDLWorkflowProtection
  const run = routeFor(graph, protection, ['extract', 'read'])

  it('reads the subscription for the signed-in customer, whatever user id and role are posted', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run(
        {
          __isInsideCustomNode: true,
          __customNodeIds: ['extract', 'read'],
          __customParams: {
            subscriptionId: 'sub-victim',
            userId: 'victim-user-id',
            role: 'admin',
            action: 'cancel_at_period_end',
          },
        },
        { id: 'attacker-user-id', email: 'attacker@shop.test', role: 'customer' }
      )
      expect(reply.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/data/ds-1/raw-query')
      expect(calls[0].json.params).toEqual(['sub-victim', 'attacker-user-id', '', 'customer'])
      expect(reply.body.results.extract).toMatchObject({
        subscriptionId: 'sub-victim',
        userId: 'attacker-user-id',
        role: 'customer',
      })
    })
  })

  it('still refuses a visitor without a session', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run({ __customParams: { userId: 'victim-user-id' } }, null)
      expect(reply.status).toBe(401)
      expect(calls).toHaveLength(0)
    })
  })
})

describe('{{Current User.*}} resolves from the session on the server', () => {
  const graph = {
    id: 'wf-favourites',
    nodes: [
      {
        id: 'list',
        type: 'data-select',
        label: 'My Favourites',
        stepNumber: 1,
        config: {
          dataSourceId: 'ds-1',
          tableName: 'favourites',
          filters: [{ column: 'user_id', operator: 'equals', value: '{{Current User.id}}' }],
        },
      },
      {
        id: 'mine',
        type: 'data-count',
        label: 'Count Mine',
        stepNumber: 2,
        config: {
          dataSourceId: 'ds-1',
          tableName: 'orders',
          filters: [{ column: 'email', operator: 'equals', value: '{{Current User.email}}' }],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'list', target: 'mine' }],
  }
  // A public page: no protection policy, so no guard runs.
  const run = routeFor(graph)
  const forgedState = {
    __stateValues: { currentUser: { id: 'victim-id', email: 'victim@shop.test' } },
    trigger: { __stateValues: { currentUser: { id: 'victim-id' } } },
    __sessionUserId: 'victim-id',
    __sessionUser: { id: 'victim-id', email: 'victim@shop.test' },
  }

  it('scopes the read to the session user, not the page state the request carries', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run(forgedState, { id: 'me-id', email: 'me@shop.test' })
      expect(reply.status).toBe(200)
      const bodies = calls.map((c) => c.json)
      expect(bodies[0].filters).toEqual([{ column: 'user_id', operator: 'equals', value: 'me-id' }])
      expect(bodies[1].filters).toEqual([
        { column: 'email', operator: 'equals', value: 'me@shop.test' },
      ])
    })
  })

  it('reads nothing for a guest — never the whole table, never the posted identity', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run(forgedState, null)
      expect(reply.status).toBe(200)
      expect(calls).toHaveLength(0)
      expect(reply.body.results.list).toEqual({ rows: [], count: 0 })
      expect(reply.body.results.mine).toEqual({ count: 0 })
    })
  })

  it('never replies the session keys', async () => {
    await withFetch(answerRows, async () => {
      const reply = await run({}, { id: 'me-id' })
      const keys = Object.keys(reply.body.results)
      expect(keys).not.toContain('__sessionUserId')
      expect(keys).not.toContain('__sessionRole')
      expect(keys).not.toContain('__sessionUser')
    })
  })
})

describe('a current-user reader result is rebuilt from the session', () => {
  const graph = {
    id: 'wf-my-orders',
    nodes: [
      {
        id: 'me',
        type: 'account-get-current',
        label: 'Get Current User',
        stepNumber: 1,
        config: {},
      },
      {
        id: 'orders',
        type: 'data-select',
        label: 'My Orders',
        stepNumber: 2,
        config: {
          dataSourceId: 'ds-1',
          tableName: 'teleport_orders',
          filters: [{ column: 'user_id', operator: 'equals', value: ref('me', 'id') }],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'me', target: 'orders' }],
  }
  const run = routeFor(graph)
  const forged = { me: { id: 'victim-id', email: 'victim@shop.test', user: { id: 'victim-id' } } }

  it('filters by the signed-in user whatever the browser says the reader answered', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run(forged, { id: 'me-id', email: 'me@shop.test', role: 'customer' })
      expect(calls).toHaveLength(1)
      expect(calls[0].json.filters[0].value).toBe('me-id')
      expect(reply.body.results.me).toMatchObject({ id: 'me-id', email: 'me@shop.test' })
    })
  })

  it('reads nothing for a guest who posts someone else as the reader result', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run(forged, null)
      expect(calls).toHaveLength(0)
      expect(reply.body.results.orders).toEqual({ rows: [], count: 0 })
    })
  })

  it('reads nothing when the identity is an "all" sentinel (an identity filter never widens)', async () => {
    const sessions = [{ id: 'all' }, { id: '   ' }]
    for (const token of sessions) {
      await withFetch(answerRows, async (calls) => {
        const reply = await run(forged, token)
        expect(calls).toHaveLength(0)
        expect(reply.body.results.orders).toEqual({ rows: [], count: 0 })
      })
    }
  })
})

describe('segment trust — what a route reads about the visitor', () => {
  it('declares nothing for a segment that never reads the visitor', () => {
    const nodes = [
      {
        id: 'calc',
        type: 'general-custom-js',
        label: 'Calc',
        stepNumber: 1,
        config: { code: 'function customHandler(){ return 1 }', context: 'server' },
      },
    ]
    const segments = splitIntoSegments({ nodes, edges: [], trigger: { type: 'manual' } } as any)
    const trust = buildSegmentTrust(segments[0], { id: 'wf', nodes, edges: [], segments } as any)
    expect(trust.session).toBeUndefined()
    expect(trust.workflowId).toBe('wf')
    expect(trust.segmentId).toBe(segments[0].id)
    expect(trust.opensRun).toBe(true)
  })
})

describe('a signed-out visitor has no identity, whatever the request names (I3)', () => {
  // A guest-capable write (checkout's order row): its owner column is bound to
  // the Resolve Current User result, which the browser relays.
  const graph = {
    id: 'wf-guest-write',
    nodes: [
      {
        id: 'resolve',
        type: 'general-custom-node',
        label: 'Resolve Current User',
        stepNumber: 1,
        config: { customNodeId: 'cn-resolve', parameters: [] },
      },
      {
        id: 'write',
        type: 'data-create-item',
        label: 'Create Order',
        stepNumber: 2,
        config: {
          dataSourceId: 'ds-1',
          tableName: 'teleport_orders',
          columnMappings: [
            { column: 'user_id', value: ref('resolve', 'userId') },
            { column: 'total', value: 10 },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'resolve', target: 'write' }],
  }
  const protection = {
    requiresAuth: false,
    allowedRoles: [],
    userScoped: { ownerColumn: 'user_id', bindings: [{ nodeId: 'resolve', path: ['userId'] }] },
  } as unknown as UIDLWorkflowProtection
  const run = routeFor(graph, protection)
  const ANON = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const forged = { resolve: { userId: 'victim-user-id', anonymousUserId: ANON } }

  it('ignores the user id a signed-out request names; the guest row keeps its anonymous id', async () => {
    await withFetch(answerRows, async (calls) => {
      const reply = await run(forged, null)
      expect(reply.status).toBe(200)
      const body = calls[0].json
      expect(body.columnMappings).toContainEqual({ column: 'user_id', value: '' })
      expect(JSON.stringify(body)).not.toContain('victim-user-id')
      // The data API writes a guest's own row under the run's anonymous id.
      expect(body.__anonymousUserId).toBe(ANON)
    })
  })

  it('writes the session user for a signed-in visitor', async () => {
    await withFetch(answerRows, async (calls) => {
      await run(forged, { id: 'me-id' })
      expect(calls[0].json.columnMappings).toContainEqual({ column: 'user_id', value: 'me-id' })
    })
  })
})

describe('the other identity sources a server step can read', () => {
  const chipTo = (nodeId: string, field: string) =>
    `<span class="context-value-inline" data-ctx-node-id="${nodeId}" data-ctx-path='["${nodeId}","${field}"]'>${field}</span>`
  const readWith = (filter: Record<string, unknown>, extraNodes: any[] = []) =>
    routeFor({
      id: 'wf-other-sources',
      nodes: [
        ...extraNodes,
        {
          id: 'read',
          type: 'data-select',
          label: 'My Rows',
          stepNumber: 5,
          config: { dataSourceId: 'ds-1', tableName: 'notes', filters: [filter] },
        },
      ],
      edges: extraNodes.map((n, i) => ({ id: `e${i}`, source: n.id, target: 'read' })),
    })

  it('reads a filter the way data-select does: destination before value', async () => {
    const run = readWith({ source: 'user_id', destination: '{{Current User.id}}', value: 'x' })
    await withFetch(answerRows, async (calls) => {
      expect((await run({}, null)).body.results.read).toEqual({ rows: [], count: 0 })
      expect(calls).toHaveLength(0)
    })
  })

  it('rebuilds an account-login result, and sees a chip pointing at it as identity', async () => {
    const login = { id: 'login', type: 'account-login', label: 'Log In', stepNumber: 1, config: {} }
    const run = readWith({ column: 'user_id', operator: 'equals', value: chipTo('login', 'id') }, [
      login,
    ])
    const forged = { login: { id: 'victim-id', user: { id: 'victim-id' }, success: true } }
    await withFetch(answerRows, async (calls) => {
      const reply = await run(forged, { id: 'me-id' })
      expect(calls[0].json.filters[0].value).toBe('me-id')
      expect(reply.body.results.login).toMatchObject({ id: 'me-id', success: true })
    })
    await withFetch(answerRows, async (calls) => {
      expect((await run(forged, null)).body.results.read).toEqual({ rows: [], count: 0 })
      expect(calls).toHaveLength(0)
    })
  })

  it('answers a read of currentUser in a nested copy of the page state from the session', async () => {
    const other = {
      id: 'other',
      type: 'state-get-local-state',
      label: 'Other',
      stepNumber: 1,
      config: {},
    }
    const run = readWith(
      {
        column: 'user_id',
        operator: 'equals',
        value: {
          type: 'workflowContext',
          nodeId: 'other',
          path: ['other', 'trigger', '__stateValues', 'currentUser', 'id'],
        },
      },
      [other]
    )
    const forged = { other: { trigger: { __stateValues: { currentUser: { id: 'victim-id' } } } } }
    await withFetch(answerRows, async (calls) => {
      await run(forged, { id: 'me-id' })
      expect(calls[0].json.filters[0].value).toBe('me-id')
    })
    await withFetch(answerRows, async (calls) => {
      expect((await run(forged, null)).body.results.read).toEqual({ rows: [], count: 0 })
      expect(calls).toHaveLength(0)
    })
  })

  it("never replies the trigger's page state rewritten", async () => {
    const run = readWith({ column: 'user_id', operator: 'equals', value: '{{Current User.id}}' })
    await withFetch(answerRows, async () => {
      const reply = await run(
        { trigger: { __stateValues: { currentUser: { id: 'victim-id' } } } },
        { id: 'me-id' }
      )
      expect(Object.keys(reply.body.results)).not.toContain('trigger')
    })
  })
})
