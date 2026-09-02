import { splitIntoSegments } from '../src/segment-splitter'
import type { UIDLWorkflow, UIDLWorkflowNode, UIDLWorkflowEdge } from '@teleporthq/teleport-types'

/**
 * The AI Assistant Chat's action layer stands or falls on ONE property of the
 * generated app: the tool must run BEFORE the answer is written, so the reply
 * can report truthfully what happened.
 *
 * The tool runs inside a `general-custom-node`, which the splitter pins to the
 * CLIENT, while both AI calls are SERVER nodes. So the walk has to produce
 * `[server: decide] [client: run] [server: answer]`.
 *
 * The chat used to express this with two plain edges out of a parse node — one
 * into the tool chain, one into the answer — and relied on the answer's PROMPT
 * referencing the tool's summary to force the ordering, because
 * `getTopologicalOrder` turns a `workflowContext` reference into a dependency
 * edge. That worked, but only by accident of the data flow: remove the
 * reference and the answer was written before the tool ran.
 *
 * The dispatch now lives inside its own custom node, so the ordering comes from
 * a real EDGE. This test pins both halves: the three-segment shape, and that it
 * survives even with no prompt reference at all.
 */

const ctx = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

const node = (
  id: string,
  type: string,
  stepNumber: number,
  config: Record<string, unknown> = {}
): UIDLWorkflowNode => ({ id, type, label: id, config, stepNumber } as unknown as UIDLWorkflowNode)

const edge = (source: string, target: string, sourceHandle?: string): UIDLWorkflowEdge =>
  ({ id: `${source}->${target}`, source, target, sourceHandle } as unknown as UIDLWorkflowEdge)

/** The chat's shape from the merge script onward. */
function buildChatWorkflow(options: { answerReferencesOutcome: boolean }): UIDLWorkflow {
  const nodes: UIDLWorkflowNode[] = [
    node('merge', 'general-custom-js', 1, { context: 'server', code: 'x' }),
    node('decide', 'ai-custom-prompt', 2, {
      jsonMode: true,
      prompt: ['ctx:', ctx('merge', ['merge', 'context'])],
    }),
    node('run', 'general-custom-node', 3, {
      customNodeId: 'custom_run_action',
      parameters: [{ key: 'decisionText', value: ctx('decide', ['decide', 'response']) }],
    }),
    node('answer', 'ai-custom-prompt', 4, {
      streaming: true,
      prompt: [
        'Context:',
        ctx('merge', ['merge', 'context']),
        ...(options.answerReferencesOutcome
          ? ['\nOutcome: ', ctx('run', ['run', 'outcomeText'])]
          : []),
      ],
    }),
  ]

  const edges: UIDLWorkflowEdge[] = [
    edge('merge', 'decide'),
    edge('decide', 'run'),
    edge('run', 'answer'),
  ]

  return { name: 'send-chat-message', nodes, edges, trigger: { type: 'manual' } } as UIDLWorkflow
}

const segmentOf = (segments: ReturnType<typeof splitIntoSegments>, nodeId: string): number =>
  segments.findIndex((segment) => segment.nodes.some((entry) => entry.id === nodeId))

describe('AI chat tool dispatch — segment ordering', () => {
  const segments = splitIntoSegments(buildChatWorkflow({ answerReferencesOutcome: true }))

  it('runs the action on the CLIENT, where general-custom-node is dispatched', () => {
    // The server handler for general-custom-node is a stub: placed in a server
    // segment the nested custom node never runs and downstream references
    // resolve to the raw marker object.
    expect(segments[segmentOf(segments, 'run')].env).toBe('client')
  })

  it('keeps both AI calls on the server', () => {
    expect(segments[segmentOf(segments, 'decide')].env).toBe('server')
    expect(segments[segmentOf(segments, 'answer')].env).toBe('server')
  })

  it('orders the answer AFTER the action', () => {
    const answerSegment = segmentOf(segments, 'answer')
    expect(answerSegment).toBeGreaterThan(segmentOf(segments, 'decide'))
    expect(answerSegment).toBeGreaterThan(segmentOf(segments, 'run'))
  })

  it('produces exactly the three-segment shape the design depends on', () => {
    expect(segments.map((segment) => segment.env)).toEqual(['server', 'client', 'server'])
  })

  it('holds the ordering on the EDGE, not on the prompt reference', () => {
    // The regression this replaces: with the old two-edges-out-of-parse shape,
    // dropping the prompt reference let the answer overtake the tool. A real
    // edge cannot be overtaken, so the shape is identical either way.
    const withoutReference = splitIntoSegments(
      buildChatWorkflow({ answerReferencesOutcome: false })
    )
    expect(withoutReference.map((segment) => segment.env)).toEqual(['server', 'client', 'server'])
    expect(segmentOf(withoutReference, 'answer')).toBeGreaterThan(
      segmentOf(withoutReference, 'run')
    )
  })
})
