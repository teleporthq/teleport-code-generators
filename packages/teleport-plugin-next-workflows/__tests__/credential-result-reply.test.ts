/* tslint:disable:function-constructor max-classes-per-file */
import * as crypto from 'crypto'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  hasStreamingAINode,
} from '../src/api-route-generator'
import { nodeRegistry } from '../src/nodes'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

/**
 * The result of the password-hashing node is a credential: a server segment
 * replies it to the browser sealed, never as it is, and a later server
 * segment still opens it and uses it. These run the GENERATED routes of each
 * flow that hashes a password, split the way the project plugin splits them.
 */

const SECRET = 'credential-results-test-secret'
const BCRYPT_SHAPED = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/

// bcryptjs is not installed in this repository; this stand-in hashes into the
// same 60-character shape, deterministically, so a test can name the hash.
const fakeBcrypt = {
  hashSync: (text: string, rounds: number): string =>
    `$2a$${String(rounds).padStart(2, '0')}$` +
    crypto.createHash('sha256').update(text).digest('hex').slice(0, 53),
  compareSync: (text: string, hash: string): boolean =>
    fakeBcrypt.hashSync(text, Number(hash.slice(4, 6))) === hash,
}

/** What the password-hashing node stores for a password (no pepper, 12 rounds). */
const hashOf = (password: string): string =>
  fakeBcrypt.hashSync(crypto.createHash('sha256').update(password).digest('base64'), 12)

class FakeOpenAI {
  public chat = {
    completions: {
      create: async () =>
        (async function* stream() {
          yield { choices: [{ delta: { content: 'Welcome' } }] }
        })(),
    },
  }
}

type Context = Record<string, any>

interface RouteReply {
  status: number
  body: { success?: boolean; results?: Context; error?: string } | undefined
  /** Everything the route sent the browser: the JSON body or every streamed frame. */
  text: string
}

interface DataCall {
  operation: string
  body: any
}

interface Graph {
  nodes: any[]
  edges: any[]
  segments: WorkflowSegment[]
}

const step = (
  id: string,
  type: string,
  stepNumber: number,
  config: Record<string, unknown> = {}
) => ({ id, type, label: id, stepNumber, config })

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

const ref = (nodeId: string, ...path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

function graphOf(nodes: any[], edges: any[]): Graph {
  const segments = splitIntoSegments({
    nodes,
    edges,
    trigger: { type: 'event-element-clicked' },
  } as any)
  return { nodes, edges, segments }
}

const serverSegments = (graph: Graph) => graph.segments.filter((s) => s.env === 'server')

function bootRoute(segment: WorkflowSegment, graph: Graph) {
  const options = { trust: buildSegmentTrust(segment, graph) }
  const source = hasStreamingAINode(segment)
    ? generateStreamingServerSegmentAPIRoute(segment, 'Flow', undefined, options)
    : generateServerSegmentAPIRoute(segment, 'Flow', undefined, options)
  const runtime = loadServerRuntime()
  const security = loadSecurityRuntime()
  const modules: Record<string, unknown> = { bcryptjs: fakeBcrypt, crypto, openai: FakeOpenAI }
  const routeModule: { exports: unknown } = { exports: {} }
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    (id: string) => {
      if (id.endsWith('server-runtime')) return runtime
      if (isSecurityRuntimeSpecifier(id)) return security
      return modules[id] || {}
    }
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  return async (context: Context): Promise<RouteReply> => {
    const reply: RouteReply = { status: 0, body: undefined, text: '' }
    const res = {
      status(code: number) {
        reply.status = code
        return this
      },
      json(payload: RouteReply['body']) {
        reply.body = payload
        reply.text += JSON.stringify(payload)
        return this
      },
      setHeader: (): void => undefined,
      writeHead(code: number) {
        reply.status = code
      },
      write(frame: string) {
        reply.text += frame
        const data = frame.replace(/^data: /, '').trim()
        const event = JSON.parse(data)
        if (event.type === 'done') {
          reply.body = { success: event.success, results: event.results }
        }
      },
      end: (): void => undefined,
    }
    await handler(
      {
        method: 'POST',
        body: { context: JSON.parse(JSON.stringify(context)) },
        headers: { host: 'shop.example' },
      },
      res
    )
    return reply
  }
}

/** The browser's side of a hop: merge the reply the way the client runtime does. */
function merge(context: Context, results: Context = {}): Context {
  return { ...context, ...results }
}

let dataCalls: DataCall[] = []
const originalFetch = globalThis.fetch
const savedSecret = process.env.NEXTAUTH_SECRET

function answerDataCalls(replies: Record<string, unknown>): void {
  dataCalls = []
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const operation = String(url).split('/').pop() as string
    dataCalls.push({ operation, body: init && init.body ? JSON.parse(init.body) : undefined })
    return { ok: true, status: 200, json: async () => replies[operation] }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

describe('the password-hashing node', () => {
  it('is the one node the registry marks as having a credential result', () => {
    const credentialTypes = Object.keys(nodeRegistry).filter(
      (nodeType) => (nodeRegistry[nodeType] as { resultIsCredential?: boolean }).resultIsCredential
    )
    expect(credentialTypes).toEqual(['account-hash-password'])
  })
})

describe('reset password: the new password hash stays on the server', () => {
  // The shape the editor builds for /reset-password (password-reset-workflows.ts).
  const NEW_PASSWORD = 'N3w-secret!'
  const reset = graphOf(
    [
      step('set-loading', 'state-update-local-state', 1, { property: 'busy', value: true }),
      step('form', 'general-extract-form-data', 2, { formNodeId: 'reset-form' }),
      step('passwords-match', 'general-if-statement', 3, {
        conditionType: 'simple-comparison',
        leftValue: ref('form', 'password'),
        operator: '===',
        rightValue: ref('form', 'confirmPassword'),
      }),
      step('token', 'url-get-query-parameter', 4, { parameterName: 'token', defaultValue: '' }),
      step('hash', 'account-hash-password', 5, { password: ref('form', 'password') }),
      step('reset', 'data-raw-query', 6, {
        dataSourceId: 'ds-1',
        query: 'SELECT $1::text AS token, $2::text AS password',
        params: [ref('token', 'value'), ref('hash', 'hash')],
      }),
      step('changed', 'general-if-statement', 7, {
        conditionType: 'simple-comparison',
        leftValue: ref('reset', 'result', '0', 'changed'),
        operator: '===',
        rightValue: 'true',
      }),
      step('done', 'state-update-local-state', 8, { property: 'busy', value: false }),
      step('invalid', 'state-update-local-state', 9, { property: 'hasError', value: true }),
      step('mismatch', 'state-update-local-state', 10, { property: 'hasError', value: true }),
    ],
    [
      edge('set-loading', 'form'),
      edge('form', 'passwords-match'),
      edge('passwords-match', 'token', 'true'),
      edge('passwords-match', 'mismatch', 'false'),
      edge('token', 'hash'),
      edge('hash', 'reset'),
      edge('reset', 'changed'),
      edge('changed', 'done', 'true'),
      edge('changed', 'invalid', 'false'),
    ]
  )
  const browserContext: Context = {
    'set-loading': { updated: true },
    form: { password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    'passwords-match': { result: true },
    token: { value: 'reset-token' },
  }

  it('hashes, writes and checks in one server segment', () => {
    expect(serverSegments(reset).map((s) => s.nodes.map((n) => n.id))).toEqual([
      ['hash', 'reset', 'changed'],
    ])
  })

  it('writes the hash, and replies the write and the check without it', async () => {
    answerDataCalls({ 'raw-query': { rows: [{ changed: 'true' }] } })
    const reply = await bootRoute(serverSegments(reset)[0], reset)(browserContext)

    expect(reply.status).toBe(200)
    expect(dataCalls).toHaveLength(1)
    expect(JSON.stringify(dataCalls[0].body)).toContain(hashOf(NEW_PASSWORD))

    const results = reply.body?.results || {}
    expect(results.reset).toEqual({ rows: [{ changed: 'true' }], result: [{ changed: 'true' }] })
    expect(results.changed).toEqual({ result: true })
    expect(reply.text).not.toContain(hashOf(NEW_PASSWORD))
    expect(reply.text).not.toMatch(BCRYPT_SHAPED)
  })

  it('replies the hash node sealed and signed, like every other server result', async () => {
    answerDataCalls({ 'raw-query': { rows: [{ changed: 'true' }] } })
    const reply = await bootRoute(serverSegments(reset)[0], reset)(browserContext)
    const results = reply.body?.results || {}
    expect(results.hash).toEqual({ __sealed: expect.any(String) })
    expect(Object.keys(results.__sig).sort()).toEqual(['changed', 'hash', 'reset'])
  })
})

describe('a later server segment still receives the hash', () => {
  const PASSWORD = 'Admin-made-1'
  // Hash, a browser step, then the write: two server segments.
  const split = graphOf(
    [
      step('form', 'general-extract-form-data', 1, { formNodeId: 'user-form' }),
      step('hash', 'account-hash-password', 2, { password: ref('form', 'password') }),
      step('busy', 'state-update-local-state', 3, { property: 'busy', value: true }),
      step('save', 'data-update-item', 4, {
        dataSourceId: 'ds-1',
        tableName: 'users',
        filters: [{ field: 'id', operator: '=', value: 'u-1' }],
        columnMappings: [{ column: 'password', value: ref('hash', 'hash') }],
      }),
      step('saved', 'state-update-local-state', 5, { property: 'busy', value: false }),
    ],
    [edge('form', 'hash'), edge('hash', 'busy'), edge('busy', 'save'), edge('save', 'saved')]
  )
  const [hashSegment, saveSegment] = serverSegments(split)

  it('splits into a hash segment and a write segment', () => {
    expect(split.segments.map((s) => s.env)).toEqual([
      'client',
      'server',
      'client',
      'server',
      'client',
    ])
    expect(hashSegment.nodes.map((n) => n.id)).toEqual(['hash'])
    expect(saveSegment.nodes.map((n) => n.id)).toEqual(['save'])
  })

  it('writes the hash the earlier segment made, and neither reply carries it', async () => {
    answerDataCalls({ update: { item: { id: 'u-1', email: 'member@example.com' }, id: 'u-1' } })
    const start: Context = { form: { password: PASSWORD } }
    const first = await bootRoute(hashSegment, split)(start)
    const held = merge(start, first.body?.results)
    expect(JSON.stringify(held)).not.toMatch(BCRYPT_SHAPED)

    const second = await bootRoute(saveSegment, split)(merge(held, { busy: { updated: true } }))
    expect(second.status).toBe(200)
    expect(dataCalls).toHaveLength(1)
    expect(dataCalls[0].body.columnMappings).toEqual([
      { column: 'password', value: hashOf(PASSWORD) },
    ])
    expect(second.text).not.toMatch(BCRYPT_SHAPED)
    expect(second.body?.results?.save).toMatchObject({ id: 'u-1', email: 'member@example.com' })
  })
})

describe('the hash as the previous result of the next server segment', () => {
  const HASH = hashOf('previous-step')

  it('reaches the next segment opened, and goes back to the browser sealed', () => {
    const runtime = loadServerRuntime()
    const first = runtime.segmentReply(
      { nodes: [{ id: 'hash', type: 'account-hash-password' }], edges: [] },
      { hash: { hash: HASH } },
      {}
    )
    expect(JSON.stringify(first)).not.toContain(HASH)

    const relayed = JSON.parse(JSON.stringify(first))
    const snapshot = runtime.snapshotIncomingContext(relayed)
    const next = {
      nodes: [{ id: 'next', type: 'general-custom-js', config: {} }],
      edges: [] as unknown[],
      entryNodeIds: ['next'],
      signedNodeIds: ['hash'],
      previousFrom: { nodeId: 'hash', fireAndForget: false },
    }
    runtime.claimSegmentContext(next, relayed)
    expect(relayed.hash).toEqual({ hash: HASH })
    expect(relayed.__previousNodeResult).toEqual({ hash: HASH })

    relayed.next = { done: true }
    const second = runtime.segmentReply(next, relayed, snapshot)
    expect(JSON.stringify(second)).not.toContain(HASH)
    expect(second.next).toEqual({ done: true })
    expect(second.hash).toEqual(first.hash)
  })

  it('is not replied at all by an app without a secret', () => {
    delete process.env.NEXTAUTH_SECRET
    const runtime = loadServerRuntime()
    const reply = runtime.segmentReply(
      { nodes: [{ id: 'hash', type: 'account-hash-password' }], edges: [] },
      { hash: { hash: HASH } },
      {}
    )
    expect(reply.hash).toBeUndefined()
  })

  it('opens under any step the browser holds it as (a custom node output), and only what the app sealed', () => {
    const runtime = loadServerRuntime()
    const sealed = runtime.segmentReply(
      { nodes: [{ id: 'hash', type: 'account-hash-password' }], edges: [] },
      { hash: { hash: HASH } },
      {}
    ).hash
    expect(sealed).toEqual({ __sealed: expect.any(String) })
    const lookalike = { __sealed: Buffer.from('typed by the page').toString('base64') }
    const context: Context = { 'custom-node': sealed, typed: lookalike }
    const snapshot = runtime.snapshotIncomingContext(context)
    const config = { nodes: [] as unknown[], edges: [] as unknown[], entryNodeIds: [] as string[] }

    runtime.claimSegmentContext(config, context)
    expect(context['custom-node']).toEqual({ hash: HASH })
    expect(context.typed).toEqual(lookalike)
    expect(JSON.stringify(runtime.segmentReply(config, context, snapshot))).not.toContain(HASH)
  })
})

describe('change password: the stored hash and the new one stay on the server', () => {
  const CURRENT = 'Old-pass-1'
  const NEXT = 'New-pass-2'
  const change = graphOf(
    [
      step('form', 'general-extract-form-data', 1, { formNodeId: 'change-form' }),
      step('account', 'data-select', 2, {
        dataSourceId: 'ds-1',
        tableName: 'users',
        filters: [{ field: 'id', operator: '=', value: 'u-1' }],
      }),
      step('verify', 'account-compare-passwords', 3, {
        password: ref('form', 'currentPassword'),
        hash: ref('account', 'rows', '0', 'password'),
      }),
      step('correct', 'general-if-statement', 4, {
        conditionType: 'simple-comparison',
        leftValue: ref('verify', 'isMatch'),
        operator: '===',
        rightValue: true,
      }),
      step('hash', 'account-hash-password', 5, { password: ref('form', 'newPassword') }),
      step('save', 'data-update-item', 6, {
        dataSourceId: 'ds-1',
        tableName: 'users',
        filters: [{ field: 'id', operator: '=', value: 'u-1' }],
        columnMappings: [{ column: 'password', value: ref('hash', 'hash') }],
      }),
      step('toast', 'toast-show', 7, { message: 'Password changed' }),
    ],
    [
      edge('form', 'account'),
      edge('account', 'verify'),
      edge('verify', 'correct'),
      edge('correct', 'hash', 'true'),
      edge('hash', 'save'),
      edge('save', 'toast'),
    ]
  )

  it('checks the current password and writes the new hash, replying neither hash', async () => {
    const user = { id: 'u-1', email: 'member@example.com', password: hashOf(CURRENT) }
    answerDataCalls({
      select: { rows: [user], count: 1 },
      update: { item: user, id: 'u-1', updatedCount: 1 },
    })
    const [segment] = serverSegments(change)
    expect(segment.nodes.map((n) => n.id)).toEqual(['account', 'verify', 'correct', 'hash', 'save'])

    const reply = await bootRoute(
      segment,
      change
    )({
      form: { currentPassword: CURRENT, newPassword: NEXT },
    })
    expect(reply.status).toBe(200)
    expect(reply.body?.results?.verify).toEqual({ isMatch: true, match: true })
    const update = dataCalls.find((call) => call.operation === 'update')
    expect(update?.body.columnMappings).toEqual([{ column: 'password', value: hashOf(NEXT) }])
    expect(reply.text).not.toMatch(BCRYPT_SHAPED)
  })
})

describe('the other ways a hash could reach the browser', () => {
  it('a streaming segment never streams it, and its closing reply carries it sealed', async () => {
    const streaming = graphOf(
      [
        step('welcome', 'ai-custom-prompt', 1, {
          prompt: 'Say welcome',
          model: 'gpt-4o-mini',
          token: 'sk-test',
          streaming: true,
        }),
        step('hash', 'account-hash-password', 2, { password: 'Streamed-1' }),
      ],
      [edge('welcome', 'hash')]
    )
    const [segment] = serverSegments(streaming)
    expect(hasStreamingAINode(segment)).toBe(true)

    const reply = await bootRoute(segment, streaming)({})
    expect(reply.text).toContain('"type":"chunk"')
    expect(reply.text).not.toMatch(BCRYPT_SHAPED)
    expect(reply.body?.results?.hash).toEqual({ __sealed: expect.any(String) })
  })

  it('a loop that maps passwords to hashes replies its results sealed', async () => {
    const loop = graphOf(
      [
        step('each', 'general-loop', 1, { collection: ['First-12', 'Second-2'], loopType: 'map' }),
        step('hash', 'account-hash-password', 2, { password: ref('each', 'currentItem') }),
      ],
      [edge('each', 'hash', 'loop')]
    )
    const [segment] = serverSegments(loop)
    const reply = await bootRoute(segment, loop)({})
    expect(reply.status).toBe(200)
    expect(reply.text).not.toMatch(BCRYPT_SHAPED)
    expect(reply.body?.results?.each).toEqual({ __sealed: expect.any(String) })

    const trust = buildSegmentTrust(segment, loop)
    const runtime = loadServerRuntime()
    const relayed = JSON.parse(JSON.stringify(reply.body?.results))
    runtime.claimSegmentContext(
      {
        nodes: [],
        edges: [],
        entryNodeIds: [],
        workflowId: trust.workflowId,
        signedNodeIds: ['each', 'hash'],
        signedBy: { each: segment.id, hash: segment.id },
      },
      relayed
    )
    expect(relayed.each.results).toEqual([
      { hash: hashOf('First-12') },
      { hash: hashOf('Second-2') },
    ])
  })

  it('a loop that only repeats the hash keeps its count readable', async () => {
    const loop = graphOf(
      [
        step('each', 'general-loop', 1, { collection: ['First-12'], loopType: 'forEach' }),
        step('hash', 'account-hash-password', 2, { password: ref('each', 'currentItem') }),
      ],
      [edge('each', 'hash', 'loop')]
    )
    const [segment] = serverSegments(loop)
    const reply = await bootRoute(segment, loop)({})
    expect(reply.body?.results?.each).toEqual({ completed: true, iterations: 1, results: [] })
    expect(reply.text).not.toMatch(BCRYPT_SHAPED)
  })
})
