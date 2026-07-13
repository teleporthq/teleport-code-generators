// Regression guard for the AI-chat "every answer errors" bug.
//
// A streaming AI node's on-end branch frequently continues into SERVER nodes
// (the AI-assistant chat workflow persists the answer: Create AI Chat Message
// -> Build Bump Conversation SQL general-custom-js -> Bump raw query). Those
// nodes execute inside their own server segments with full configs, and the
// browser bundle only ships their config REDACTED to the client-safe
// whitelist (segment-splitter's redactServerNodeConfig) — for
// general-custom-js that means `config.code` is gone.
//
// The client 'done' handler in callStreamingServerSegment used to execute the
// ENTIRE on-end branch with CLIENT handlers, so the redacted
// general-custom-js crashed on `code.length` ("Cannot read properties of
// undefined") and the workflow error handler wiped the streamed answer —
// reproduced live against a published chat bundle.
//
// The fix: emitted nodes carry `executionEnv`, and the client runtime filters
// on-stream / on-end branch execution down to client-executable nodes. Server
// branch nodes stay server-side where they already run with full configs.

import {
  generateSharedRuntimeUtilsCode,
  generateClientRuntimeCode,
} from '../src/executor-generator'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'
import { splitIntoSegments } from '../src/segment-splitter'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  hasStreamingAINode,
} from '../src/api-route-generator'

const TRIGGER_ID = 'trigger-1'
const AI_ID = 'ai-1'
const ON_STREAM_CLIENT_ID = 'stream-client-1'
const ON_END_SERVER_JS_ID = 'end-server-js-1'
const ON_END_SERVER_SQL_ID = 'end-server-sql-1'
const ON_END_CLIENT_ID = 'end-client-1'

const BUMP_SQL = 'UPDATE ai_chat_conversations SET updated_at = NOW() WHERE id = $1'

// ---- runtime module loading (same eval approach as loop-collection-unwrap) ----

interface RuntimeModules {
  utils: Record<string, unknown>
  runtime: {
    callStreamingServerSegment: (
      segmentUrl: string,
      context: Record<string, unknown>,
      streamingInfo: unknown,
      allNodes: unknown[],
      allEdges: unknown[],
      clientHandlers: Record<string, unknown>,
      workflowConfig: unknown,
      executionId: string
    ) => Promise<Record<string, boolean>>
    findStreamingAINodes: (nodes: unknown[], edges: unknown[]) => Record<string, unknown>
  }
}

function loadRuntimeModules(): RuntimeModules {
  const utilsModule = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports,
    () => ({})
  )
  const clientModule = { exports: {} as unknown as RuntimeModules['runtime'] }
  const requireShim = (path: string) => {
    if (path === './runtime-utils') {
      return utilsModule.exports
    }
    throw new Error(`Unexpected require in client runtime: ${path}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateClientRuntimeCode())(
    clientModule,
    clientModule.exports,
    requireShim
  )
  return { utils: utilsModule.exports, runtime: clientModule.exports }
}

// Nodes exactly as the browser bundle sees them: server configs redacted to
// the client-safe whitelist, every node stamped with its executionEnv.
const clientBundleNodes = () => [
  {
    id: TRIGGER_ID,
    type: 'event-element-clicked',
    config: {},
    stepNumber: 0,
    executionEnv: 'client',
  },
  {
    id: AI_ID,
    type: 'ai-custom-prompt',
    config: { streaming: true },
    stepNumber: 1,
    executionEnv: 'server',
  },
  {
    id: ON_STREAM_CLIENT_ID,
    type: 'state-update-local-state',
    config: { property: 'answer' },
    stepNumber: 2,
    executionEnv: 'client',
  },
  {
    id: ON_END_SERVER_JS_ID,
    type: 'general-custom-js',
    config: {},
    stepNumber: 3,
    executionEnv: 'server',
  },
  {
    id: ON_END_SERVER_SQL_ID,
    type: 'data-raw-query',
    config: {},
    stepNumber: 4,
    executionEnv: 'server',
  },
  {
    id: ON_END_CLIENT_ID,
    type: 'state-update-local-state',
    config: { property: 'done' },
    stepNumber: 5,
    executionEnv: 'client',
  },
]

const workflowEdges = () => [
  { id: 'e1', source: TRIGGER_ID, target: AI_ID },
  { id: 'e2', source: AI_ID, target: ON_STREAM_CLIENT_ID, sourceHandle: 'on-stream' },
  { id: 'e3', source: AI_ID, target: ON_END_SERVER_JS_ID, sourceHandle: 'on-end' },
  { id: 'e4', source: ON_END_SERVER_JS_ID, target: ON_END_SERVER_SQL_ID },
  { id: 'e5', source: ON_END_SERVER_SQL_ID, target: ON_END_CLIENT_ID },
]

// Minimal SSE response: one chunk event for the AI node, then done.
function fakeSseResponse(events: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder()
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  let sent = false
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read: async () => {
            if (sent) {
              return { done: true, value: undefined }
            }
            sent = true
            return { done: false, value: encoder.encode(payload) }
          },
        }
      },
    },
  }
}

describe('callStreamingServerSegment — on-stream/on-end env filter', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('executes ONLY client-executable branch nodes client-side; server branch nodes are skipped but still marked handled', async () => {
    const { runtime } = loadRuntimeModules()
    const nodes = clientBundleNodes()
    const edges = workflowEdges()

    const calls: string[] = []
    const clientHandlers = {
      'state-update-local-state': async (config: { property?: string }) => {
        calls.push(`state:${config.property}`)
        return { success: true }
      },
      // The real client bundle ships general-custom-js (universal). With the
      // redacted `{}` config it used to crash on `code.length`; the filter
      // must prevent it from being invoked at all.
      'general-custom-js': async () => {
        calls.push('general-custom-js')
        throw new Error('server node executed with client handlers')
      },
      'data-raw-query': async () => {
        calls.push('data-raw-query')
        throw new Error('server node executed with client handlers')
      },
    }

    global.fetch = jest.fn(async () =>
      fakeSseResponse([
        { type: 'chunk', nodeId: AI_ID, chunk: 'Hel', fullResponse: 'Hel', model: 'gpt' },
        { type: 'done', results: { [AI_ID]: { fullResponse: 'Hello' } } },
      ])
    ) as unknown as typeof fetch

    const streamingInfo = runtime.findStreamingAINodes(nodes, edges)
    const context: Record<string, unknown> = {}
    const handled = await runtime.callStreamingServerSegment(
      '/api/workflows/seg-1',
      context,
      streamingInfo,
      nodes,
      edges,
      clientHandlers as unknown as Record<string, unknown>,
      { triggerNodeId: TRIGGER_ID, nodes, edges },
      'exec-1'
    )

    // Client branch nodes ran (on-stream state update + on-end state update).
    expect(calls).toContain('state:answer')
    expect(calls).toContain('state:done')
    // Server branch nodes were NEVER executed with client handlers.
    expect(calls).not.toContain('general-custom-js')
    expect(calls).not.toContain('data-raw-query')
    // All on-end branch nodes stay marked handled so later client segments
    // do not re-run them (unchanged bookkeeping semantics).
    expect(handled[ON_END_SERVER_JS_ID]).toBe(true)
    expect(handled[ON_END_SERVER_SQL_ID]).toBe(true)
    expect(handled[ON_END_CLIENT_ID]).toBe(true)
  })

  it('keeps executing branch nodes WITHOUT an executionEnv marker (older bundles)', async () => {
    const { runtime } = loadRuntimeModules()
    const nodes = clientBundleNodes().map((n) => {
      const { executionEnv, ...rest } = n
      void executionEnv
      return rest
    })
    const edges = workflowEdges()

    const calls: string[] = []
    const clientHandlers = {
      'state-update-local-state': async (config: { property?: string }) => {
        calls.push(`state:${config.property}`)
        return { success: true }
      },
      'general-custom-js': async () => {
        calls.push('general-custom-js')
        return {}
      },
      'data-raw-query': async () => {
        calls.push('data-raw-query')
        return {}
      },
    }

    global.fetch = jest.fn(async () =>
      fakeSseResponse([
        { type: 'chunk', nodeId: AI_ID, chunk: 'Hi', fullResponse: 'Hi', model: 'gpt' },
        { type: 'done', results: {} },
      ])
    ) as unknown as typeof fetch

    const streamingInfo = runtime.findStreamingAINodes(nodes, edges)
    await runtime.callStreamingServerSegment(
      '/api/workflows/seg-1',
      {},
      streamingInfo,
      nodes,
      edges,
      clientHandlers as unknown as Record<string, unknown>,
      { triggerNodeId: TRIGGER_ID, nodes, edges },
      'exec-2'
    )

    // Fail-open: without the marker, behavior is unchanged from older bundles.
    expect(calls).toContain('general-custom-js')
    expect(calls).toContain('data-raw-query')
  })
})

// ---- emission side: the client module must stamp executionEnv ----

const buildChatWorkflow = (): any => ({
  id: 'wf-chat',
  name: 'Process Chat Message',
  trigger: {
    type: 'event-page-loaded',
    nodeId: TRIGGER_ID,
    scope: 'page',
    config: { pageId: 'page-1' },
  },
  nodes: [
    {
      id: AI_ID,
      type: 'ai-custom-prompt',
      config: { prompt: 'Answer the user', model: 'gpt-4o', streaming: true },
      stepNumber: 1,
      label: 'Answer',
    },
    {
      id: ON_STREAM_CLIENT_ID,
      type: 'state-update-local-state',
      config: { property: 'answer' },
      stepNumber: 2,
      label: 'Show partial answer',
    },
    {
      id: ON_END_SERVER_JS_ID,
      type: 'general-custom-js',
      config: { context: 'server', code: 'function customHandler(params) { return {}; }' },
      stepNumber: 3,
      label: 'Build Bump Conversation SQL',
    },
    {
      id: ON_END_SERVER_SQL_ID,
      type: 'data-raw-query',
      config: { dataSourceId: 'ds-1', query: BUMP_SQL, params: [] },
      stepNumber: 4,
      label: 'Bump conversation',
    },
  ],
  edges: [
    { id: 'e1', source: TRIGGER_ID, target: AI_ID },
    { id: 'e2', source: AI_ID, target: ON_STREAM_CLIENT_ID, sourceHandle: 'on-stream' },
    { id: 'e3', source: AI_ID, target: ON_END_SERVER_JS_ID, sourceHandle: 'on-end' },
    { id: 'e4', source: ON_END_SERVER_JS_ID, target: ON_END_SERVER_SQL_ID },
  ],
})

const buildStructure = (): any => ({
  uidl: {
    name: 'Page',
    outputOptions: { pageId: 'page-1', fileName: 'page-1' },
    node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
    stateDefinitions: { answer: { type: 'string', defaultValue: '' } },
  },
  chunks: [
    {
      type: 'chunk-type-ast',
      name: 'jsx-component',
      content: {
        type: 'VariableDeclaration',
        declarations: [
          {
            type: 'VariableDeclarator',
            init: {
              type: 'ArrowFunctionExpression',
              body: {
                type: 'BlockStatement',
                body: [{ type: 'ReturnStatement', argument: null }],
              },
            },
          },
        ],
      },
    },
  ],
  options: {
    workflows: { workflows: { 'wf-chat': buildChatWorkflow() }, customNodes: {} },
  },
  dependencies: {},
})

describe('client module emission stamps executionEnv per node', () => {
  let moduleCode: string

  beforeAll(async () => {
    const plugin = createNextWorkflowPlugin({ isPage: true })
    const structure = buildStructure()
    await plugin(structure as any)
    const moduleChunk = (structure.chunks as any[]).find((c: any) => c.name === 'workflow-module')
    if (!moduleChunk) {
      throw new Error('workflow-module chunk not emitted by plugin')
    }
    moduleCode = String(moduleChunk.content)
  })

  it('marks server nodes and client nodes with their env in the top-level node list', () => {
    expect(moduleCode).toContain(`"id":"${ON_END_SERVER_SQL_ID}","type":"data-raw-query"`)
    expect(moduleCode).toContain('"executionEnv":"server"')
    expect(moduleCode).toContain('"executionEnv":"client"')
  })

  it('still redacts server node config (env stamp must not weaken redaction)', () => {
    expect(moduleCode).not.toContain(BUMP_SQL)
    expect(moduleCode).not.toContain('function customHandler')
  })
})

describe('server segments still execute the on-end server nodes with full config', () => {
  it('emits the on-end server nodes into server routes with their real config', () => {
    const segments = splitIntoSegments(buildChatWorkflow())
    const serverSegments = segments.filter((s) => s.env === 'server')
    expect(serverSegments.length).toBeGreaterThan(0)

    const serverNodeIds = new Set(serverSegments.flatMap((s) => s.nodes.map((n) => n.id)))
    expect(serverNodeIds.has(ON_END_SERVER_JS_ID)).toBe(true)
    expect(serverNodeIds.has(ON_END_SERVER_SQL_ID)).toBe(true)

    const routes = serverSegments.map((s) =>
      hasStreamingAINode(s)
        ? generateStreamingServerSegmentAPIRoute(s, 'Process Chat Message')
        : generateServerSegmentAPIRoute(s, 'Process Chat Message')
    )
    const combined = routes.join('\n')
    expect(combined).toContain(BUMP_SQL)
    expect(combined).toContain('function customHandler')
  })
})
