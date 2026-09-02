import {
  generateStreamingServerSegmentAPIRoute,
  hasStreamingAINode,
} from '../src/api-route-generator'
import { generateClientRuntimeCode } from '../src/executor-generator'
import { generateAIStreamingProviderUtils } from '../src/nodes/ai/ai-provider-utils'
import { splitIntoSegments } from '../src/segment-splitter'
import type { Workflow } from '@teleporthq/teleport-types'

const TRIGGER_ID = 'trigger-1'
const AI_ID = 'ai-1'
const ON_STREAM_ID = 'stream-client-1'

/** The smallest workflow that produces a streaming server segment. */
function buildStreamingWorkflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Send Chat Message',
    nodes: [
      { id: TRIGGER_ID, type: 'event-element-clicked', config: {}, stepNumber: 0 },
      {
        id: AI_ID,
        type: 'ai-custom-prompt',
        config: { prompt: ['Answer'], model: 'gpt-4o-mini', streaming: true, token: '' },
        stepNumber: 1,
      },
      {
        id: ON_STREAM_ID,
        type: 'state-update-local-state',
        config: { property: 'answer' },
        stepNumber: 2,
      },
    ],
    edges: [
      { id: 'e1', source: TRIGGER_ID, target: AI_ID },
      { id: 'e2', source: AI_ID, target: ON_STREAM_ID, sourceHandle: 'on-stream' },
    ],
  } as unknown as Workflow
}

function streamingRoute(): string {
  const segments = splitIntoSegments(buildStreamingWorkflow())
  const streaming = segments.filter((segment) => hasStreamingAINode(segment))
  expect(streaming.length).toBeGreaterThan(0)
  return streaming
    .map((segment) => generateStreamingServerSegmentAPIRoute(segment, 'Send Chat Message'))
    .join('\n')
}

/** The object literal a `res.write` of a chunk frame serialises. */
function chunkFrameBody(code: string): string {
  const marker = "type: 'chunk'"
  const start = code.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf('}', start))
}

describe('what a streamed chunk tells the browser', () => {
  it('sends the text and nothing about the provider', () => {
    // The model name is an implementation detail of the workspace's AI
    // settings; it has no business being visible in a public page's network
    // tab, and nothing on the client ever read it.
    const frame = chunkFrameBody(streamingRoute())
    expect(frame).toContain('chunk: chunkData.chunk')
    expect(frame).toContain('fullResponse: chunkData.fullResponse')
    expect(frame).not.toContain('model')
  })

  it('keeps the same shape in the context the on-stream nodes read', () => {
    const route = streamingRoute()
    expect(route).toContain(
      'context[node.id] = { chunk: chunkData.chunk, fullResponse: chunkData.fullResponse };'
    )
  })

  it('stores no model when the browser parses a chunk frame', () => {
    expect(generateClientRuntimeCode()).toContain(
      'context[data.nodeId] = { chunk: data.chunk, fullResponse: data.fullResponse };'
    )
  })

  it("still returns the model in the node's final result", () => {
    // Only the per-chunk payload changed: the finished node result is what
    // usage accounting and the workflow context legitimately read.
    const providerUtils = generateAIStreamingProviderUtils()
    expect(providerUtils).toContain('return { response: fullResponse, model: model')
    expect(providerUtils).toContain(
      'await streamCallback({ chunk: chunk, fullResponse: fullResponse });'
    )
  })
})
