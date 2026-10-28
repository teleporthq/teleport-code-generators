// When a streamed AI reply ends, its on-end branch has to run in the order its
// edges give. The site AI chat's branch (teleport-gui,
// process-chat-message-custom-node-builder.ts, buildAllEdges) is three server
// steps followed by four browser steps:
//
//   Assess Knowledge Coverage → Create AI Chat Message → Bump Conversation After Reply
//   → Get Chat Messages for Final Update → Finalize AI Response
//   → Update Chat with Final Response → Reset Send Button (Done)
//
// The splitter interleaves them with the on-stream steps, so the three server
// steps land in segments AFTER the stream and the four browser steps in the
// last segment. The browser used to run its four steps the moment the stream
// ended and then skip that last segment, so the reply was finalised and the
// send button unlocked before the reply had been saved.

import {
  generateClientRuntimeCode,
  generateSharedRuntimeUtilsCode,
} from '../src/executor-generator'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { resolveNodeExecutionEnv, splitIntoSegments } from '../src/segment-splitter'

interface ChatNode {
  id: string
  type: string
  label: string
  config: Record<string, unknown>
  stepNumber: number
}

const ctx = (nodeId: string, path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

const script = (name: string) =>
  `function customHandler(previousContext, params) { return { ${name}: true }; }`

// The chat's graph from the merge step on, numbered the way the editor numbers
// it (breadth-first depth), which is what decides the interleaving.
const chatNodes = (): ChatNode[] => [
  {
    id: 'merge',
    type: 'general-custom-js',
    label: 'Merge Knowledge Search Results',
    config: { context: 'server', code: script('merged') },
    stepNumber: 1,
  },
  {
    id: 'answer',
    type: 'ai-custom-prompt',
    label: 'AI: Generate Answer from Context',
    config: { streaming: true, prompt: 'Answer the visitor' },
    stepNumber: 2,
  },
  {
    id: 'stream-get',
    type: 'state-get-local-state',
    label: 'Get Chat Messages for Stream Update',
    config: { property: 'chatMessages', testStep: 'stream-get' },
    stepNumber: 3,
  },
  {
    id: 'stream-append',
    type: 'general-custom-js',
    label: 'Append AI Stream Chunk to Response',
    config: { context: 'client', code: script('streamMessages'), testStep: 'stream-append' },
    stepNumber: 4,
  },
  {
    id: 'stream-set',
    type: 'state-update-local-state',
    label: 'Update Chat Messages with Stream',
    config: {
      property: 'chatMessages',
      value: ctx('stream-append', ['streamMessages']),
      testStep: 'stream-set',
    },
    stepNumber: 5,
  },
  {
    id: 'assess',
    type: 'general-custom-js',
    label: 'Assess Knowledge Coverage',
    config: { context: 'server', code: script('coveredByKnowledge') },
    stepNumber: 3,
  },
  {
    id: 'store',
    type: 'data-create-item',
    label: 'Create AI Chat Message',
    config: {
      dataSourceId: 'ds-1',
      tableName: 'teleport_ai_chat_messages',
      columnMappings: [
        { column: 'message', value: ctx('answer', ['response']) },
        { column: 'covered_by_knowledge', value: ctx('assess', ['coveredByKnowledge']) },
      ],
    },
    stepNumber: 4,
  },
  {
    id: 'bump',
    type: 'data-raw-query',
    label: 'Bump Conversation After Reply',
    config: {
      dataSourceId: 'ds-1',
      query: 'UPDATE teleport_ai_chat_conversations SET message_count = message_count + 1',
      queryVariables: [],
    },
    stepNumber: 5,
  },
  {
    id: 'final-get',
    type: 'state-get-local-state',
    label: 'Get Chat Messages for Final Update',
    config: { property: 'chatMessages', testStep: 'final-get' },
    stepNumber: 6,
  },
  {
    id: 'finalize',
    type: 'general-custom-js',
    label: 'Finalize AI Response',
    config: { context: 'client', code: script('finalMessages'), testStep: 'finalize' },
    stepNumber: 7,
  },
  {
    id: 'final-set',
    type: 'state-update-local-state',
    label: 'Update Chat with Final Response',
    config: {
      property: 'chatMessages',
      value: ctx('finalize', ['finalMessages']),
      testStep: 'final-set',
    },
    stepNumber: 8,
  },
  {
    id: 'reset',
    type: 'state-update-local-state',
    label: 'Reset Send Button (Done)',
    config: { property: 'canSendMessage', value: false, testStep: 'reset' },
    stepNumber: 9,
  },
]

const chatEdges = () => [
  { id: 'e-merge', source: 'merge', target: 'answer' },
  { id: 'e-stream', source: 'answer', target: 'stream-get', sourceHandle: 'on-stream' },
  { id: 'e-stream-1', source: 'stream-get', target: 'stream-append' },
  { id: 'e-stream-2', source: 'stream-append', target: 'stream-set' },
  { id: 'e-end', source: 'answer', target: 'assess', sourceHandle: 'on-end' },
  { id: 'e-end-1', source: 'assess', target: 'store' },
  { id: 'e-end-2', source: 'store', target: 'bump' },
  { id: 'e-end-3', source: 'bump', target: 'final-get' },
  { id: 'e-end-4', source: 'final-get', target: 'finalize' },
  { id: 'e-end-5', source: 'finalize', target: 'final-set' },
  { id: 'e-end-6', source: 'final-set', target: 'reset' },
]

const chatSegments = () =>
  splitIntoSegments({
    nodes: chatNodes(),
    edges: chatEdges(),
    trigger: { type: 'manual' },
  } as never)

const segmentUrl = (segmentId: string) => `/api/workflows/chat-${segmentId}`

// The steps the visitor's browser runs once the stream has ended.
const FINAL_BROWSER_STEPS = ['final-get', 'finalize', 'final-set', 'reset']

const EXPECTED_RUN = [
  'server: Merge Knowledge Search Results, AI: Generate Answer from Context',
  'browser: stream-get',
  'browser: stream-append',
  'browser: stream-set',
  'server: Assess Knowledge Coverage',
  'server: Create AI Chat Message',
  'server: Bump Conversation After Reply',
  ...FINAL_BROWSER_STEPS.map((step) => `browser: ${step}`),
]

function sseResponse(events: Array<Record<string, unknown>>) {
  const payload = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  )
  let sent = false
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) {
            return { done: true, value: undefined }
          }
          sent = true
          return { done: false, value: payload }
        },
      }),
    },
  }
}

const SERVER_RESULTS: Record<string, Record<string, unknown>> = {
  assess: { coveredByKnowledge: true },
  store: { id: 'message-1' },
  bump: { rowCount: 1 },
}

// Answers every segment call the way the generated routes do, and logs it.
function installSegmentFetch(log: string[]) {
  const segments = chatSegments()
  const scope = globalThis as Record<string, unknown>
  scope.fetch = async (url: string) => {
    const segment = segments.find((entry) => segmentUrl(entry.id) === url)
    if (!segment) {
      throw new Error(`Unexpected fetch: ${url}`)
    }
    log.push(`server: ${segment.nodes.map((node) => node.label).join(', ')}`)
    if (segment.nodes.some((node) => node.id === 'answer')) {
      return sseResponse([
        { type: 'chunk', nodeId: 'answer', chunk: 'Hello', fullResponse: 'Hello' },
        {
          type: 'done',
          results: {
            merge: { merged: true },
            answer: { response: 'Hello', fullResponse: 'Hello' },
          },
        },
      ])
    }
    const results: Record<string, unknown> = {}
    segment.nodes.forEach((node) => {
      results[node.id] = SERVER_RESULTS[node.id]
    })
    return { ok: true, status: 200, json: async () => ({ success: true, results }) }
  }
}

function browserHandlers(log: string[]) {
  const record = (config: { testStep?: string }) => {
    log.push(`browser: ${config.testStep}`)
    return { success: true, value: [] as unknown[] }
  }
  return {
    'state-get-local-state': async (config: { testStep?: string }) => record(config),
    'state-update-local-state': async (config: { testStep?: string }) => record(config),
    'general-custom-js': async (config: { testStep?: string }) => record(config),
  }
}

function loadRuntime() {
  const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports,
    () => ({})
  )
  const runtimeModule: { exports: Record<string, any> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateClientRuntimeCode())(
    runtimeModule,
    runtimeModule.exports,
    (id: string) => {
      if (id === './runtime-utils') {
        return utilsModule.exports
      }
      throw new Error(`Unexpected require in client runtime: ${id}`)
    }
  )
  return { utils: utilsModule.exports, runtime: runtimeModule.exports }
}

const segmentIndexOf = (segments: ReturnType<typeof chatSegments>, nodeId: string) =>
  segments.findIndex((segment) => segment.nodes.some((node) => node.id === nodeId))

describe('a streamed reply runs its on-end steps in edge order', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).fetch = originalFetch
  })

  it('ships the chat with the final browser steps in a segment after the three server steps', () => {
    const segments = chatSegments()
    const lastServerStep = Math.max(
      ...['assess', 'store', 'bump'].map((id) => segmentIndexOf(segments, id))
    )
    FINAL_BROWSER_STEPS.forEach((id) => {
      expect(segments[segmentIndexOf(segments, id)].env).toBe('client')
      expect(segmentIndexOf(segments, id)).toBeGreaterThan(lastServerStep)
    })
  })

  it('the emitted runtime runs no step when the stream reports done', () => {
    const source = generateClientRuntimeCode()
    const streamingCall = source.slice(
      source.indexOf('async function callStreamingServerSegment'),
      source.indexOf('async function executeWorkflowWithSegments')
    )
    const doneBranch = streamingCall.slice(
      streamingCall.indexOf("data.type === 'done'"),
      streamingCall.indexOf("data.type === 'error'")
    )
    expect(doneBranch).toContain('mergeServerResults')
    expect(doneBranch).not.toContain('executeNodes')
    expect(doneBranch).not.toContain('handledNodeIds')
  })

  it('in the chat custom node, the reply is finalised only after it is saved', async () => {
    const segments = chatSegments()
    const serverUrls: Record<string, string> = {}
    segments
      .filter((segment) => segment.env === 'server')
      .forEach((segment) => {
        serverUrls[segment.id] = segmentUrl(segment.id)
      })
    const plugin = new NextWorkflowProjectPlugin() as unknown as {
      generateCustomNodesFile: (
        nodes: Record<string, unknown>,
        urls: Record<string, Record<string, string>>
      ) => string
    }
    const source = plugin.generateCustomNodesFile(
      {
        'cn-chat': {
          id: 'cn-chat',
          name: 'Process Chat Message',
          parameters: [],
          nodes: chatNodes(),
          edges: chatEdges(),
        },
      },
      { 'cn-chat': serverUrls }
    )
    const { utils, runtime } = loadRuntime()
    const customNodes: { exports: Record<string, any> } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', source)(
      customNodes,
      customNodes.exports,
      (id: string) => (id === './runtime-utils' ? utils : id === './runtime' ? runtime : {})
    )

    const log: string[] = []
    installSegmentFetch(log)
    await customNodes.exports['cn-chat']({}, {}, browserHandlers(log))

    expect(log).toEqual(EXPECTED_RUN)
  })

  it('in a page workflow, the browser step after a server step waits for it', async () => {
    const segments = chatSegments()
    const serverUrls: Record<string, string> = {}
    segments
      .filter((segment) => segment.env === 'server')
      .forEach((segment) => {
        serverUrls[segment.id] = segmentUrl(segment.id)
      })
    const nodes = chatNodes().map((node) => ({
      ...node,
      executionEnv: resolveNodeExecutionEnv(node as never),
    }))
    const workflowConfig = {
      triggerNodeId: 'trigger',
      nodes,
      edges: [{ id: 'e-trigger', source: 'trigger', target: 'merge' }, ...chatEdges()],
      segments: segments.map((segment) => ({
        id: segment.id,
        env: segment.env,
        nodes: segment.nodes,
        edges: segment.edges,
      })),
    }
    const { runtime } = loadRuntime()

    const log: string[] = []
    installSegmentFetch(log)
    await runtime.executeWorkflowWithSegments(workflowConfig, {}, browserHandlers(log), serverUrls)

    expect(log).toEqual(EXPECTED_RUN)
  })
})
