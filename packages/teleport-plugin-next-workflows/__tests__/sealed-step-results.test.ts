/* tslint:disable:function-constructor max-classes-per-file no-bitwise */
import * as crypto from 'crypto'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  hasStreamingAINode,
} from '../src/api-route-generator'
import {
  generateClientRuntimeCode,
  generateSharedRuntimeUtilsCode,
} from '../src/executor-generator'
import { assertSegmentRouteGates, collectWorkflowPublishRefusals } from '../src/publish-refusals'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust, SegmentGraph } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

/**
 * A server step marked `sealResultOnServer` reaches the browser sealed:
 * encrypted and authenticated with a key derived from the app secret, bound to
 * the workflow, the run and the step. The browser carries it to the next server
 * request as it is, and every later server route of the same run opens it
 * before its steps read it. These run the GENERATED routes — a workflow's and
 * a custom node's, the browser side through the generated browser runtime —
 * split the way the project plugin splits them.
 */

const SECRET = 'sealed-step-results-test-secret'
const PASSAGE_MARK = 'kb-passage-'

type Context = Record<string, any>

interface Row {
  title: string
  body: string
}

const passages = (sentence: string, repeat: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `Policy ${i + 1}`,
    body: `${PASSAGE_MARK}${i + 1} ${sentence.repeat(repeat)}`,
  }))

/** A knowledge base whose merged context is about 24,000 characters. */
const KNOWLEDGE = passages('Returns are accepted within thirty days of delivery. ', 37, 12)

/** The same, in a script whose every character takes three bytes. */
const WIDE_KNOWLEDGE = passages('退货须在收货后三十天内办理。', 150, 13)

/** One that fits an AI step's prompt (AI_MAX_PROMPT_CHARS). */
const SMALL_KNOWLEDGE = passages('Returns are accepted within thirty days of delivery. ', 10, 3)

const mergedContextOf = (rows: Row[]): string =>
  rows.map((row) => `${row.title}\n${row.body}`).join('\n---\n')

const checksumOf = (text: string): number => {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

// ---------------------------------------------------------------------------
// The steps (the editor's AI chat, reduced to its hand-off: search → merge →
// answer, a browser step, then the coverage check in a later request)
// ---------------------------------------------------------------------------

const MERGE_BODY = [
  "var context = rows.map(function (row) { return row.title + '\\n' + row.body; }).join('\\n---\\n');",
  "return { context: context, hasContext: rows.length > 0, documentCount: rows.length, sessionContext: 'Signed-out visitor' };",
].join('\n')

const COVERAGE_BODY = [
  "var text = merge && typeof merge.context === 'string' ? merge.context : '';",
  'var hash = 5381;',
  'for (var i = 0; i < text.length; i++) { hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0; }',
  'return { covered: !!(merge && merge.hasContext === true), contextChars: text.length, checksum: hash >>> 0 };',
].join('\n')

const ANSWER_BODY =
  "return { text: 'Answered from ' + (merge ? merge.documentCount : 0) + ' passages', contextChars: merge && merge.context ? merge.context.length : 0 };"

const ref = (nodeId: string, ...path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

const step = (
  id: string,
  type: string,
  stepNumber: number,
  config: Record<string, unknown> = {}
) => ({ id, type, label: id, stepNumber, config })

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

const browserStep = (id: string, stepNumber: number, value: unknown = true) =>
  step(id, 'state-update-local-state', stepNumber, { property: id, value })

const serverScript = (
  id: string,
  stepNumber: number,
  code: string,
  extra: Record<string, unknown> = {}
) => step(id, 'general-custom-js', stepNumber, { context: 'server', code, ...extra })

const sealedIf = (sealed: boolean): Record<string, unknown> =>
  sealed ? { sealResultOnServer: true } : {}

const chain = (ids: string[]) => ids.slice(1).map((id, i) => edge(ids[i], id))

/** The chat's hand-off as a workflow: its scripts read their inputs by name. */
const workflowChat = (rows: Row[], sealed: boolean) => {
  const nodes = [
    browserStep('busy', 1),
    serverScript(
      'search',
      2,
      `function customHandler(params) { return { rows: ${JSON.stringify(rows)} }; }`,
      { keepResultOnServer: true }
    ),
    serverScript(
      'merge',
      3,
      `function customHandler(params) {\nvar rows = (params.search && params.search.rows) || [];\n${MERGE_BODY}\n}`,
      { params: { search: ref('search') }, ...sealedIf(sealed) }
    ),
    serverScript(
      'answer',
      4,
      `function customHandler(params) {\nvar merge = params.merge;\n${ANSWER_BODY}\n}`,
      { params: { merge: ref('merge') } }
    ),
    browserStep('show', 5, ref('answer', 'text')),
    serverScript(
      'coverage',
      6,
      `function customHandler(params) {\nvar merge = params.merge;\n${COVERAGE_BODY}\n}`,
      { params: { merge: ref('merge') } }
    ),
    browserStep('done', 7, false),
  ]
  return {
    id: 'wf-chat',
    name: 'Chat',
    trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
    nodes,
    edges: chain(nodes.map((n) => n.id)),
  }
}

/**
 * The chat's hand-off as a custom node: its scripts read the steps by
 * position, as the editor's chat builder does (`params[N]` over the custom
 * node's steps, the running step left out).
 */
const customNodeChat = (rows: Row[], sealed: boolean) => {
  const nodes = [
    browserStep('busy', 1),
    serverScript(
      'search',
      2,
      `function customHandler(previousContext, params) { return { rows: ${JSON.stringify(
        rows
      )} }; }`,
      { keepResultOnServer: true }
    ),
    serverScript(
      'merge',
      3,
      `function customHandler(previousContext, params) {\nvar rows = (params[1] && params[1].rows) || [];\n${MERGE_BODY}\n}`,
      sealedIf(sealed)
    ),
    serverScript(
      'answer',
      4,
      `function customHandler(previousContext, params) {\nvar merge = params[2];\n${ANSWER_BODY}\n}`
    ),
    browserStep('show', 5, ref('answer', 'text')),
    serverScript(
      'coverage',
      6,
      `function customHandler(previousContext, params) {\nvar merge = params[2];\n${COVERAGE_BODY}\n}`
    ),
    browserStep('done', 7, false),
  ]
  return {
    id: 'cn-chat',
    name: 'Process Chat Message',
    parameters: [] as unknown[],
    nodes,
    edges: chain(nodes.map((n) => n.id)),
  }
}

// ---------------------------------------------------------------------------
// The generated routes, the browser runtime and a fetch between them
// ---------------------------------------------------------------------------

interface RouteReply {
  status: number
  body: { success?: boolean; results?: Context; error?: string } | undefined
  /** Everything the route sent the browser: the JSON body or every streamed frame. */
  text: string
}

type Route = (context: Context) => Promise<RouteReply>

const prompts: unknown[] = []

class FakeOpenAI {
  public chat = {
    completions: {
      create: async (request: unknown) => {
        prompts.push(request)
        return (async function* stream() {
          yield { choices: [{ delta: { content: 'Returns take thirty days.' } }] }
        })()
      },
    },
  }
}

const graphOf = (owner: {
  id: string
  trigger?: { type: string; nodeId?: string }
  nodes: any[]
  edges: any[]
}): SegmentGraph => {
  const segments = splitIntoSegments({
    nodes: owner.nodes,
    edges: owner.edges,
    trigger: owner.trigger || { type: 'manual' },
  } as any)
  return {
    id: owner.id,
    triggerNodeId: owner.trigger && owner.trigger.nodeId,
    nodes: owner.nodes,
    edges: owner.edges,
    segments,
  }
}

const serverSegments = (graph: SegmentGraph) => graph.segments.filter((s) => s.env === 'server')

let runtime: Record<string, any>
let security: unknown

function bootRoute(segment: WorkflowSegment, graph: SegmentGraph, customNodeIds?: string[]): Route {
  const options = {
    trust: buildSegmentTrust(segment, graph),
    ...(customNodeIds ? { customNodeIds } : {}),
  }
  const source = hasStreamingAINode(segment)
    ? generateStreamingServerSegmentAPIRoute(segment, 'Chat', undefined, options)
    : generateServerSegmentAPIRoute(segment, 'Chat', undefined, options)
  const modules: Record<string, unknown> = { crypto, openai: FakeOpenAI }
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
        const event = JSON.parse(frame.replace(/^data: /, '').trim())
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

const routesOf = (graph: SegmentGraph, customNodeIds?: string[]): Route[] =>
  serverSegments(graph).map((segment) => bootRoute(segment, graph, customNodeIds))

const routeUrl = (ownerId: string, segmentId: string) => `/api/workflows/${ownerId}-${segmentId}`

/** The browser's side of a hop: merge the reply the way the client runtime does. */
const merge = (context: Context, results: Context = {}): Context => ({ ...context, ...results })

function loadBrowserRuntime() {
  const shared: { exports: Record<string, any> } = { exports: {} }
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(shared, shared.exports)
  const client: { exports: Record<string, any> } = { exports: {} }
  new Function('module', 'exports', 'require', generateClientRuntimeCode())(
    client,
    client.exports,
    (id: string) => (id === './runtime-utils' ? shared.exports : {})
  )
  return { utils: shared.exports, runtime: client.exports }
}

interface BrowserTraffic {
  /** Every request body the browser sent a route. */
  requests: string[]
  /** Everything every route sent the browser. */
  replies: string[]
}

/** Runs `run` with the page's fetch answered by the generated routes. */
async function asBrowser<T>(
  routes: Record<string, Route>,
  run: () => Promise<T>
): Promise<{ result: T } & BrowserTraffic> {
  const traffic: BrowserTraffic = { requests: [], replies: [] }
  const scope = globalThis as Record<string, unknown>
  const previous = scope.fetch
  scope.fetch = async (url: string, init: { body: string }) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const route = routes[path]
    if (!route) {
      throw new Error(`no route at ${path}`)
    }
    traffic.requests.push(init.body)
    const reply = await route(JSON.parse(init.body).context)
    traffic.replies.push(reply.text)
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      statusText: '',
      json: async () => reply.body,
    }
  }
  try {
    const result = await run()
    return { result, ...traffic }
  } finally {
    scope.fetch = previous
  }
}

interface BrowserStepCall {
  nodeId: string
  value: unknown
}

const browserHandlers = (calls: BrowserStepCall[]) => ({
  'state-update-local-state': async (config: Record<string, unknown>) => {
    calls.push({ nodeId: String(config.property), value: config.value })
    return { updated: true }
  },
})

/** A workflow run as the page runs it: its browser steps here, its server segments over fetch. */
async function runWorkflowInBrowser(workflow: ReturnType<typeof workflowChat>) {
  const graph = graphOf(workflow)
  const urls: Record<string, string> = {}
  const routes: Record<string, Route> = {}
  for (const segment of serverSegments(graph)) {
    urls[segment.id] = routeUrl(workflow.id, segment.id)
    routes[urls[segment.id]] = bootRoute(segment, graph)
  }
  const browser = loadBrowserRuntime()
  const calls: BrowserStepCall[] = []
  const workflowConfig = {
    triggerNodeId: workflow.trigger.nodeId,
    nodes: workflow.nodes,
    edges: workflow.edges,
    segments: graph.segments.map((s) => ({
      id: s.id,
      env: s.env,
      hasStreamingAI: hasStreamingAINode(s),
      nodes: s.nodes,
      edges: s.edges,
    })),
  }
  const traffic = await asBrowser(routes, () =>
    browser.runtime.executeWorkflowWithSegments(
      workflowConfig,
      { clicked: true },
      browserHandlers(calls),
      urls
    )
  )
  return { ...traffic, calls }
}

/** A custom node run as a page runs it, through the generated custom-nodes module. */
async function runCustomNodeInBrowser(customNode: ReturnType<typeof customNodeChat>) {
  const graph = graphOf(customNode)
  const urls: Record<string, string> = {}
  const routes: Record<string, Route> = {}
  const customNodeIds = customNode.nodes.map((n) => n.id)
  for (const segment of serverSegments(graph)) {
    urls[segment.id] = routeUrl(customNode.id, segment.id)
    routes[urls[segment.id]] = bootRoute(segment, graph, customNodeIds)
  }
  const plugin = new NextWorkflowProjectPlugin() as unknown as {
    generateCustomNodesFile: (
      nodes: Record<string, unknown>,
      serverUrls: Record<string, Record<string, string>>
    ) => string
  }
  const source = plugin.generateCustomNodesFile(
    { [customNode.id]: customNode },
    { [customNode.id]: urls }
  )
  const browser = loadBrowserRuntime()
  const moduleStub: { exports: Record<string, (...args: unknown[]) => Promise<unknown>> } = {
    exports: {},
  }
  new Function('module', 'exports', 'require', source)(
    moduleStub,
    moduleStub.exports,
    (id: string) =>
      id === './runtime-utils' ? browser.utils : id === './runtime' ? browser.runtime : {}
  )
  const calls: BrowserStepCall[] = []
  const traffic = await asBrowser(routes, () =>
    moduleStub.exports[customNode.id]({ trigger: { clicked: true } }, {}, browserHandlers(calls))
  )
  return { ...traffic, calls }
}

/** The result a reply carries for a step, read the way the browser holds it. */
const replied = (text: string, nodeId: string): unknown => {
  const parsed = JSON.parse(text)
  return parsed.results ? parsed.results[nodeId] : undefined
}

const SEALED = { __sealedForRun: expect.any(String) }

const sealedLength = (value: unknown): number => {
  expect(value).toEqual(SEALED)
  return (value as { __sealedForRun: string }).__sealedForRun.length
}

// ---------------------------------------------------------------------------
// A fixed clock and fixed random bytes, so two runs answer the same bytes
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_800_000_000_000

function withFixedClockAndRandomness(): () => void {
  let counter = 0
  const now = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
  const random = jest
    .spyOn(jest.requireActual('crypto'), 'randomBytes')
    .mockImplementation((size: unknown) => {
      counter += 1
      return Buffer.alloc(Number(size), counter)
    })
  return () => {
    now.mockRestore()
    random.mockRestore()
  }
}

const digest = (traffic: BrowserTraffic | string[]): string =>
  crypto.createHash('sha256').update(JSON.stringify(traffic)).digest('hex')

// ---------------------------------------------------------------------------

const savedSecret = process.env.NEXTAUTH_SECRET

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET
  runtime = loadServerRuntime()
  security = loadSecurityRuntime()
  prompts.length = 0
})

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

describe('the chat hand-off splits as the editor builds it', () => {
  it('runs search, merge and answer in one server request and the coverage check in a later one', () => {
    for (const graph of [
      graphOf(workflowChat(KNOWLEDGE, true)),
      graphOf(customNodeChat(KNOWLEDGE, true)),
    ]) {
      expect(graph.segments.map((s) => [s.env, s.nodes.map((n) => n.id)])).toEqual([
        ['client', ['busy']],
        ['server', ['search', 'merge', 'answer']],
        ['client', ['show']],
        ['server', ['coverage']],
        ['client', ['done']],
      ])
    }
  })
})

describe('which steps sealResultOnServer seals', () => {
  it('seals a server step, never a step that keeps its result, an if / switch or a browser step', () => {
    const nodes = [
      serverScript('sealed', 1, 'function customHandler() { return {}; }', sealedIf(true)),
      serverScript('kept', 2, 'function customHandler() { return {}; }', {
        keepResultOnServer: true,
        ...sealedIf(true),
      }),
      {
        ...step('decide', 'general-if-statement', 3, {
          conditionType: 'simple-comparison',
          leftValue: 1,
          operator: '===',
          rightValue: 1,
          ...sealedIf(true),
        }),
        executionEnv: 'server',
      },
      serverScript('plain', 4, 'function customHandler() { return {}; }'),
      step('shown', 'state-update-local-state', 5, { property: 'x', value: 1, ...sealedIf(true) }),
    ]
    const graph = graphOf({
      id: 'wf-which',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes,
      edges: chain(nodes.map((n) => n.id)),
    })
    const [segment] = serverSegments(graph)
    expect(buildSegmentTrust(segment, graph).sealedNodeIds).toEqual(['sealed'])
    expect(buildSegmentTrust(segment, graphOf(workflowChat(KNOWLEDGE, false)))).not.toHaveProperty(
      'sealedNodeIds'
    )
  })
})

describe('a workflow step marked sealResultOnServer', () => {
  it('reaches the browser unreadable, and the later coverage check reads it intact', async () => {
    const run = await runWorkflowInBrowser(workflowChat(KNOWLEDGE, true))
    const context = mergedContextOf(KNOWLEDGE)

    expect(run.replies).toHaveLength(2)
    for (const text of [...run.replies, ...run.requests]) {
      expect(text).not.toContain(PASSAGE_MARK)
      expect(text).not.toContain('Signed-out visitor')
    }
    expect(replied(run.replies[0], 'merge')).toEqual(SEALED)
    expect(replied(run.replies[0], 'answer')).toEqual({
      text: 'Answered from 12 passages',
      contextChars: context.length,
    })
    expect(replied(run.replies[1], 'coverage')).toEqual({
      covered: true,
      contextChars: context.length,
      checksum: checksumOf(context),
    })
    expect(run.calls.map((call) => call.nodeId)).toEqual(['busy', 'show', 'done'])
    expect(run.calls[1].value).toBe('Answered from 12 passages')
  })

  it('keeps the sealed form within a third over the plain one', async () => {
    const sealedRun = await runWorkflowInBrowser(workflowChat(KNOWLEDGE, true))
    const plainRun = await runWorkflowInBrowser(workflowChat(KNOWLEDGE, false))
    const plain = JSON.stringify(replied(plainRun.replies[0], 'merge'))
    const sealed = sealedLength(replied(sealedRun.replies[0], 'merge'))

    expect(plain.length).toBeGreaterThan(23_500)
    expect(sealed).toBeLessThanOrEqual(Math.ceil((Buffer.byteLength(plain) + 28) / 3) * 4)
    expect(sealed / plain.length).toBeLessThan(1.34)
  })

  it('reaches the browser signed, like every other server result', async () => {
    const [first] = routesOf(graphOf(workflowChat(KNOWLEDGE, true)))
    const reply = await first({ busy: { updated: true } })
    expect(reply.body?.results?.merge).toEqual(SEALED)
    expect(Object.keys(reply.body?.results?.__sig || {}).sort()).toEqual(['answer', 'merge'])
    expect(reply.body?.results?.search).toBeUndefined()
  })
})

describe('a custom node step marked sealResultOnServer', () => {
  it('reaches the browser unreadable, and the later coverage check reads it intact', async () => {
    const run = await runCustomNodeInBrowser(customNodeChat(KNOWLEDGE, true))
    const context = mergedContextOf(KNOWLEDGE)

    for (const text of [...run.replies, ...run.requests]) {
      expect(text).not.toContain(PASSAGE_MARK)
    }
    expect(replied(run.replies[0], 'merge')).toEqual(SEALED)
    expect(replied(run.replies[0], 'answer')).toEqual({
      text: 'Answered from 12 passages',
      contextChars: context.length,
    })
    expect(replied(run.replies[1], 'coverage')).toEqual({
      covered: true,
      contextChars: context.length,
      checksum: checksumOf(context),
    })
  })

  it('crosses whole when sealing takes it past the size a request keeps of one value', async () => {
    const run = await runCustomNodeInBrowser(customNodeChat(WIDE_KNOWLEDGE, true))
    const context = mergedContextOf(WIDE_KNOWLEDGE)

    expect(JSON.stringify(context).length).toBeLessThan(100_000)
    expect(sealedLength(replied(run.replies[0], 'merge'))).toBeGreaterThan(100_000)
    expect(run.replies.join('')).not.toContain(PASSAGE_MARK)
    expect(replied(run.replies[1], 'coverage')).toEqual({
      covered: true,
      contextChars: context.length,
      checksum: checksumOf(context),
    })
  })
})

describe('a sealed result opens only in the run and at the step that sealed it', () => {
  const chat = graphOf(workflowChat(KNOWLEDGE, true))

  async function firstHop() {
    const [first] = routesOf(chat)
    const start: Context = { trigger: { clicked: true }, busy: { updated: true } }
    const reply = await first(start)
    return merge(start, reply.body?.results)
  }

  const coverageOf = async (held: Context) => {
    const [, coverage] = routesOf(chat)
    const reply = await coverage(merge(held, { show: { updated: true } }))
    expect(reply.status).toBe(200)
    return reply.body?.results?.coverage
  }

  const NOTHING_READ = { covered: false, contextChars: 0, checksum: 5381 }

  it('opens in the run it was sealed in', async () => {
    const held = await firstHop()
    expect(held.merge).toEqual(SEALED)
    const coverage = await coverageOf(held)
    expect(coverage.covered).toBe(true)
  })

  it('is refused once a character of it changed', async () => {
    const held = await firstHop()
    const sealed: string = held.merge.__sealedForRun
    const flipped = sealed.charAt(40) === 'A' ? 'B' : 'A'
    held.merge = { __sealedForRun: sealed.slice(0, 40) + flipped + sealed.slice(41) }
    expect(await coverageOf(held)).toEqual(NOTHING_READ)
  })

  it('is refused in another run of the same workflow', async () => {
    const earlier = await firstHop()
    const later = await firstHop()
    expect(later.__sigRun.id).not.toBe(earlier.__sigRun.id)
    expect(await coverageOf({ ...later, merge: earlier.merge })).toEqual(NOTHING_READ)
  })

  describe('binds the workflow, the run and the step into the seal itself', () => {
    const producer = (workflowId: string) => ({
      workflowId,
      segmentId: 'producer',
      opensRun: true,
      nodes: [{ id: 'merge', type: 'general-custom-js', config: {} }],
      edges: [] as unknown[],
      entryNodeIds: ['merge'],
      sealedNodeIds: ['merge'],
    })
    const seal = (workflowId: string, value: unknown) => {
      const context: Context = {}
      runtime.claimSegmentContext(producer(workflowId), context)
      context.merge = value
      return runtime.segmentReply(producer(workflowId), context, {})
    }
    /** What a later segment's steps read under `key`, its graph sealing `sealedNodeId`. */
    const claimed = (
      workflowId: string,
      sealedNodeId: string,
      run: unknown,
      key: string,
      value: unknown
    ) => {
      const reader = {
        workflowId,
        segmentId: 'reader',
        nodes: [] as unknown[],
        edges: [] as unknown[],
        entryNodeIds: [] as string[],
        sealedNodeIds: [sealedNodeId],
      }
      const context: Context = { __sigRun: run, [key]: value }
      runtime.claimSegmentContext(reader, context)
      return context[key]
    }

    it('opens as its own step, in its own run, of its own workflow', () => {
      const first = seal('wf-a', { context: 'first' })
      const elsewhere = seal('wf-b', { context: 'elsewhere' })
      expect([first.merge, elsewhere.merge]).toEqual([SEALED, SEALED])
      expect(claimed('wf-a', 'merge', first.__sigRun, 'merge', first.merge)).toEqual({
        context: 'first',
      })
      expect(claimed('wf-b', 'merge', elsewhere.__sigRun, 'merge', elsewhere.merge)).toEqual({
        context: 'elsewhere',
      })
    })

    it('is emptied in another run, as another step or in another workflow', () => {
      const first = seal('wf-a', { context: 'first' })
      const second = seal('wf-a', { context: 'second' })
      const elsewhere = seal('wf-b', { context: 'elsewhere' })
      expect(claimed('wf-a', 'merge', second.__sigRun, 'merge', first.merge)).toBeUndefined()
      expect(claimed('wf-a', 'answer', first.__sigRun, 'answer', first.merge)).toBeUndefined()
      expect(claimed('wf-b', 'merge', elsewhere.__sigRun, 'merge', first.merge)).toBeUndefined()
    })

    it('stays sealed under the key of a step the browser runs', () => {
      const first = seal('wf-a', { context: 'first' })
      expect(first.merge).toEqual(SEALED)
      expect(claimed('wf-a', 'merge', first.__sigRun, 'show', first.merge)).toEqual(first.merge)
    })
  })

  it('is read by the later request whatever else the browser holds of it', async () => {
    const held = await firstHop()
    expect(held.merge).toEqual(SEALED)
    const [, coverage] = routesOf(chat)
    const reply = await coverage(merge(held, { show: held.merge }))
    expect(reply.body?.results?.coverage.covered).toBe(true)
    expect(reply.text).not.toContain(PASSAGE_MARK)
  })

  it('goes back sealed as the previous result of the next server request', () => {
    const value = { context: `${PASSAGE_MARK}1` }
    const producer = {
      workflowId: 'wf',
      segmentId: 'producer',
      opensRun: true,
      nodes: [{ id: 'merge', type: 'general-custom-js', config: {} }],
      edges: [] as unknown[],
      entryNodeIds: ['merge'],
      sealedNodeIds: ['merge'],
    }
    const produced: Context = {}
    runtime.claimSegmentContext(producer, produced)
    produced.merge = value
    const first = runtime.segmentReply(producer, produced, {})

    const relayed = JSON.parse(JSON.stringify(first))
    const snapshot = runtime.snapshotIncomingContext(relayed)
    const next = {
      workflowId: 'wf',
      segmentId: 'next',
      nodes: [{ id: 'next', type: 'general-custom-js', config: {} }],
      edges: [] as unknown[],
      entryNodeIds: ['next'],
      signedNodeIds: ['merge'],
      signedBy: { merge: 'producer' },
      sealedNodeIds: ['merge'],
      previousFrom: { nodeId: 'merge', fireAndForget: false },
    }
    runtime.claimSegmentContext(next, relayed)
    expect(relayed.merge).toEqual(value)
    expect(relayed.__previousNodeResult).toEqual(value)

    relayed.next = { done: true }
    const second = runtime.segmentReply(next, relayed, snapshot)
    expect(JSON.stringify(second)).not.toContain(PASSAGE_MARK)
    expect(second.next).toEqual({ done: true })
    expect(second.__previousNodeResult).toEqual(first.merge)
  })

  it('is not replied at all by an app without a secret', async () => {
    delete process.env.NEXTAUTH_SECRET
    const [first] = routesOf(chat)
    const reply = await first({ busy: { updated: true } })
    expect(reply.status).toBe(200)
    expect(reply.body?.results?.merge).toBeUndefined()
    expect(reply.text).not.toContain(PASSAGE_MARK)
  })
})

describe('a sealed result in a streaming request', () => {
  const streamingChat = (sealed: boolean) => {
    const nodes = [
      browserStep('busy', 1),
      serverScript(
        'search',
        2,
        `function customHandler(params) { return { rows: ${JSON.stringify(SMALL_KNOWLEDGE)} }; }`,
        { keepResultOnServer: true }
      ),
      serverScript(
        'merge',
        3,
        `function customHandler(params) {\nvar rows = (params.search && params.search.rows) || [];\n${MERGE_BODY}\n}`,
        { params: { search: ref('search') }, ...sealedIf(sealed) }
      ),
      step('answer', 'ai-custom-prompt', 4, {
        model: 'gpt-4o-mini',
        token: 'sk-test',
        streaming: true,
        prompt: ['Context:\n"""\n', ref('merge', 'context'), '\n"""\nQuestion: returns?'],
      }),
      browserStep('show', 5, ref('answer', 'response')),
      serverScript(
        'coverage',
        6,
        `function customHandler(params) {\nvar merge = params.merge;\n${COVERAGE_BODY}\n}`,
        { params: { merge: ref('merge') } }
      ),
    ]
    return graphOf({
      id: 'wf-stream',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes,
      edges: chain(nodes.map((n) => n.id)),
    })
  }

  it('streams the answer without it, hands the model the context, and the later check reads it', async () => {
    const graph = streamingChat(true)
    const [stream, coverage] = routesOf(graph)
    expect(hasStreamingAINode(serverSegments(graph)[0])).toBe(true)

    const start: Context = { trigger: { clicked: true }, busy: { updated: true } }
    const first = await stream(start)
    expect(first.text).toContain('"type":"chunk"')
    expect(first.text).not.toContain(PASSAGE_MARK)
    expect(first.body?.results?.merge).toEqual(SEALED)
    expect(JSON.stringify(prompts)).toContain(
      JSON.stringify(mergedContextOf(SMALL_KNOWLEDGE)).slice(1, -1)
    )

    const second = await coverage(merge(merge(start, first.body?.results), { show: {} }))
    expect(second.body?.results?.coverage).toMatchObject({ covered: true })
  })
})

describe('a sealed result in a loop', () => {
  const loopFlow = (sealed: boolean) => {
    const nodes = [
      step('each', 'general-loop', 1, { collection: ['returns', 'shipping'], loopType: 'map' }),
      serverScript(
        'passage',
        2,
        `function customHandler(params) { return { text: '${PASSAGE_MARK}' + params.topic }; }`,
        { params: { topic: ref('each', 'currentItem') }, ...sealedIf(sealed) }
      ),
      browserStep('show', 3),
      serverScript(
        'read',
        4,
        'function customHandler(params) { var each = params.each || {}; return { texts: (each.results || []).map(function (r) { return r && r.text ? r.text.length : 0; }) }; }',
        { params: { each: ref('each') } }
      ),
    ]
    return graphOf({
      id: 'wf-loop',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes,
      edges: [edge('each', 'passage', 'loop'), edge('each', 'show'), edge('show', 'read')],
    })
  }

  it('replies the map loop of a sealed step sealed, and the later request reads its results', async () => {
    const graph = loopFlow(true)
    expect(graph.segments.map((s) => [s.env, s.nodes.map((n) => n.id)])).toEqual([
      ['server', ['each', 'passage']],
      ['client', ['show']],
      ['server', ['read']],
    ])
    const [loop, read] = routesOf(graph)
    const start: Context = { trigger: { clicked: true } }
    const first = await loop(start)
    expect(first.status).toBe(200)
    expect(first.text).not.toContain(PASSAGE_MARK)
    expect(first.body?.results?.each).toEqual(SEALED)
    expect(first.body?.results?.passage).toEqual(SEALED)

    const second = await read(merge(merge(start, first.body?.results), { show: {} }))
    expect(second.body?.results?.read).toEqual({
      texts: [`${PASSAGE_MARK}returns`.length, `${PASSAGE_MARK}shipping`.length],
    })
  })
})

describe('a sealed result on a branch', () => {
  const branchFlow = () => {
    const nodes = [
      {
        ...step('gate', 'general-if-statement', 1, {
          conditionType: 'simple-comparison',
          leftValue: ref('trigger', 'wantsAnswer'),
          operator: '===',
          rightValue: true,
        }),
        executionEnv: 'server',
      },
      serverScript(
        'merge',
        2,
        `function customHandler(params) { return { context: '${PASSAGE_MARK}1', hasContext: true }; }`,
        sealedIf(true)
      ),
      serverScript('fallback', 3, "function customHandler(params) { return { note: 'none' }; }"),
      browserStep('show', 4),
      browserStep('note', 5),
      serverScript(
        'coverage',
        6,
        `function customHandler(params) {\nvar merge = params.merge;\n${COVERAGE_BODY}\n}`,
        { params: { merge: ref('merge') } }
      ),
      serverScript(
        'after',
        7,
        'function customHandler(params) { return { note: params.fallback && params.fallback.note, merge: params.merge === undefined ? "absent" : "present" }; }',
        { params: { fallback: ref('fallback'), merge: ref('merge') } }
      ),
    ]
    return graphOf({
      id: 'wf-branch',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes,
      edges: [
        edge('gate', 'merge', 'true'),
        edge('gate', 'fallback', 'false'),
        edge('merge', 'show'),
        edge('show', 'coverage'),
        edge('fallback', 'note'),
        edge('note', 'after'),
      ],
    })
  }

  const runBranch = async (wantsAnswer: boolean) => {
    const [decide, later] = routesOf(branchFlow())
    const start: Context = { trigger: { wantsAnswer } }
    const first = await decide(start)
    const held = merge(start, first.body?.results)
    const second = await later(merge(held, wantsAnswer ? { show: {} } : { note: {} }))
    return { first, second }
  }

  it('splits the branches into one server request before the browser steps and one after', () => {
    expect(branchFlow().segments.map((s) => [s.env, s.nodes.map((n) => n.id)])).toEqual([
      ['server', ['gate', 'merge', 'fallback']],
      ['client', ['show', 'note']],
      ['server', ['coverage', 'after']],
    ])
  })

  it('is read later on the branch taken', async () => {
    const taken = await runBranch(true)
    expect(taken.first.body?.results?.merge).toEqual(SEALED)
    expect(taken.first.text).not.toContain(PASSAGE_MARK)
    expect(taken.second.body?.results?.coverage).toMatchObject({ covered: true })
    expect(taken.second.body?.results?.after).toBeUndefined()
  })

  it('is absent, and the later request still runs, on the branch not taken', async () => {
    const other = await runBranch(false)
    expect(other.first.body?.results?.merge).toBeUndefined()
    expect(other.first.body?.results?.__skippedNodes).toMatchObject({ merge: true })
    expect(other.second.status).toBe(200)
    expect(other.second.body?.results?.after).toEqual({ note: 'none', merge: 'absent' })
    expect(other.second.body?.results?.coverage).toBeUndefined()
  })
})

describe('publishing a workflow whose browser step reads a sealed result', () => {
  const READER_REFUSAL =
    'The step "show" (show) in "Chat" reads the result of "merge" (merge), which stays sealed outside the site\'s server, so a step in the visitor\'s browser cannot read it. Read it in a step that runs on the server, or run the setup of the feature that made this workflow again, then publish again.'

  const readsMerge = (workflow: ReturnType<typeof workflowChat>, value: unknown) => ({
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === 'show' ? { ...node, config: { ...node.config, value } } : node
    ),
  })

  it('is refused for a context reference, naming the step', () => {
    const workflow = readsMerge(workflowChat(KNOWLEDGE, true), ref('merge', 'context'))
    const refusals = collectWorkflowPublishRefusals({
      workflows: { [workflow.id]: workflow },
    } as any)
    expect(refusals.filter((r) => r.check === 'sealed-results')).toEqual([
      {
        kind: 'refused',
        check: 'sealed-results',
        ownerId: 'wf-chat',
        ownerKind: 'workflow',
        nodeId: 'show',
        message: READER_REFUSAL,
      },
    ])

    const graph = graphOf(workflow)
    const [producer] = serverSegments(graph)
    expect(() =>
      assertSegmentRouteGates(producer, buildSegmentTrust(producer, graph), {
        owner: 'Chat',
        graphNodes: workflow.nodes as any,
      })
    ).toThrow(READER_REFUSAL)
  })

  it('is refused for a context chip in a text', () => {
    const chip =
      '<p>Context: <span class="context-value-inline" data-ctx-node-id="merge" data-ctx-path="[&quot;merge&quot;,&quot;context&quot;]">context</span></p>'
    const workflow = readsMerge(workflowChat(KNOWLEDGE, true), chip)
    const refusals = collectWorkflowPublishRefusals({
      workflows: { [workflow.id]: workflow },
    } as any)
    expect(refusals.filter((r) => r.check === 'sealed-results').map((r) => r.nodeId)).toEqual([
      'show',
    ])
  })

  it('is refused inside a custom node', () => {
    const customNode = customNodeChat(KNOWLEDGE, true)
    customNode.nodes = customNode.nodes.map((node) =>
      node.id === 'show' ? { ...node, config: { ...node.config, value: ref('merge') } } : node
    )
    const refusals = collectWorkflowPublishRefusals({
      workflows: {},
      customNodes: { [customNode.id]: customNode },
    } as any)
    expect(refusals.filter((r) => r.check === 'sealed-results')).toEqual([
      expect.objectContaining({ ownerId: 'cn-chat', ownerKind: 'custom-node', nodeId: 'show' }),
    ])
  })

  it('passes when only server steps read it', () => {
    const workflow = workflowChat(KNOWLEDGE, true)
    const customNode = customNodeChat(KNOWLEDGE, true)
    const refusals = collectWorkflowPublishRefusals({
      workflows: { [workflow.id]: workflow },
      customNodes: { [customNode.id]: customNode },
    } as any)
    expect(refusals.filter((r) => r.check === 'sealed-results')).toEqual([])
  })
})

describe('runs without sealResultOnServer', () => {
  // Digests of every request the browser sent and every byte a route
  // answered, recorded with the generator before `sealResultOnServer` existed,
  // on a fixed clock and fixed random bytes.
  const RECORDED = {
    workflow: 'c3275ae51eadf5401a5a93c3755c59ead7db69c5a4da5f84df1725025794b852',
    customNode: '5f815b1a31d6ffdf2cbcfe301e000bf9f447458384840799b96069924a5bfbd2',
    streaming: '45c8f75472ba00568da2b8825c1fae187f1957b2dac453c2cd0b191f4f7e9bcf',
    loop: '935d1bd5504c6f26e84e4bdb80c42a5ad4429d9713b60b95995b87491850ff66',
    branch: 'cbeacc987a7a5b2d76aa46222fd46074ee2c0b0b1e9d6ac703a6ab4e8fa0ed35',
  }

  let restore: () => void
  beforeEach(() => {
    restore = withFixedClockAndRandomness()
  })
  afterEach(() => restore())

  it('answer the browser the same bytes as before', async () => {
    const workflow = await runWorkflowInBrowser(workflowChat(KNOWLEDGE, false))
    const customNode = await runCustomNodeInBrowser(customNodeChat(KNOWLEDGE, false))

    const streamingGraph = (() => {
      const nodes = [
        serverScript(
          'merge',
          1,
          `function customHandler(params) { return { context: '${PASSAGE_MARK}1' }; }`
        ),
        step('answer', 'ai-custom-prompt', 2, {
          model: 'gpt-4o-mini',
          token: 'sk-test',
          streaming: true,
          prompt: ['Context: ', ref('merge', 'context')],
        }),
        browserStep('show', 3),
        serverScript(
          'after',
          4,
          'function customHandler(params) { return { seen: !!params.merge }; }',
          {
            params: { merge: ref('merge') },
          }
        ),
      ]
      return graphOf({
        id: 'wf-stream-plain',
        trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
        nodes,
        edges: chain(nodes.map((n) => n.id)),
      })
    })()
    const [stream, after] = routesOf(streamingGraph)
    const streamStart: Context = { trigger: { clicked: true } }
    const streamFirst = await stream(streamStart)
    const streamSecond = await after(
      merge(merge(streamStart, streamFirst.body?.results), { show: {} })
    )

    const loopGraph = graphOf({
      id: 'wf-loop-plain',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes: [
        step('each', 'general-loop', 1, { collection: ['returns', 'shipping'], loopType: 'map' }),
        serverScript(
          'passage',
          2,
          `function customHandler(params) { return { text: '${PASSAGE_MARK}' + params.topic }; }`,
          {
            params: { topic: ref('each', 'currentItem') },
          }
        ),
        browserStep('show', 3),
        serverScript(
          'read',
          4,
          'function customHandler(params) { return { results: (params.each || {}).results }; }',
          {
            params: { each: ref('each') },
          }
        ),
      ],
      edges: [edge('each', 'passage', 'loop'), edge('each', 'show'), edge('show', 'read')],
    })
    const [loop, read] = routesOf(loopGraph)
    const loopFirst = await loop({ trigger: { clicked: true } })
    const loopSecond = await read(
      merge(merge({ trigger: { clicked: true } }, loopFirst.body?.results), { show: {} })
    )

    const branchGraph = graphOf({
      id: 'wf-branch-plain',
      trigger: { type: 'event-element-clicked', nodeId: 'trigger' },
      nodes: [
        {
          ...step('gate', 'general-if-statement', 1, {
            conditionType: 'simple-comparison',
            leftValue: ref('trigger', 'wantsAnswer'),
            operator: '===',
            rightValue: true,
          }),
          executionEnv: 'server',
        },
        serverScript(
          'merge',
          2,
          `function customHandler(params) { return { context: '${PASSAGE_MARK}1' }; }`
        ),
        serverScript('fallback', 3, 'function customHandler(params) { return { context: "" }; }'),
        browserStep('show', 4),
        serverScript(
          'coverage',
          5,
          `function customHandler(params) {\nvar merge = params.merge;\n${COVERAGE_BODY}\n}`,
          {
            params: { merge: ref('merge') },
          }
        ),
      ],
      edges: [
        edge('gate', 'merge', 'true'),
        edge('gate', 'fallback', 'false'),
        edge('merge', 'show'),
        edge('fallback', 'show'),
        edge('show', 'coverage'),
      ],
    })
    const branchTexts: string[] = []
    for (const wantsAnswer of [true, false]) {
      const [decide, coverage] = routesOf(branchGraph)
      const start: Context = { trigger: { wantsAnswer } }
      const first = await decide(start)
      const held = merge(start, first.body?.results)
      if (!wantsAnswer) {
        held.__skippedNodes = { merge: true }
      }
      const second = await coverage(merge(held, { show: {} }))
      branchTexts.push(first.text, second.text)
    }

    expect({
      workflow: digest({ requests: workflow.requests, replies: workflow.replies }),
      customNode: digest({ requests: customNode.requests, replies: customNode.replies }),
      streaming: digest([streamFirst.text, streamSecond.text]),
      loop: digest([loopFirst.text, loopSecond.text]),
      branch: digest(branchTexts),
    }).toEqual(RECORDED)
    expect(workflow.replies.join('')).toContain(PASSAGE_MARK)
  })

  it('answer the same bytes twice on the fixed clock', async () => {
    const first = await runWorkflowInBrowser(workflowChat(KNOWLEDGE, false))
    restore()
    restore = withFixedClockAndRandomness()
    const second = await runWorkflowInBrowser(workflowChat(KNOWLEDGE, false))
    expect(digest({ requests: second.requests, replies: second.replies })).toBe(
      digest({ requests: first.requests, replies: first.replies })
    )
  })
})
