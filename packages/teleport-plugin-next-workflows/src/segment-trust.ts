import { UIDLWorkflowEdge, UIDLWorkflowNode } from '@teleporthq/teleport-types'
import { isFireAndForgetSegment } from './await-result'
import { WorkflowSegment } from './types'

/**
 * What a server segment route may believe about the context a request hands
 * it. A workflow runs as a chain of segments, and the results of every earlier
 * server segment reach a later one THROUGH the caller (the browser relays
 * them), so each of those results carries the signature the segment that
 * produced it added (see the server runtime: `claimSegmentContext`,
 * `segmentReply`). This module computes, at generation time, the facts about
 * the whole graph a single route needs to check that:
 *
 * - `signedNodeIds`: the server-run nodes OUTSIDE this segment. A result the
 *   request carries for one of them is only used when its signature holds.
 * - `branchGates`: every server-run if / switch outside this segment whose
 *   branches reach nodes inside it. The route skips a gated node unless the
 *   gate's signed result took its branch — a caller can no longer run the
 *   write a guard refused by simply not marking it skipped.
 * - `loopBodies`: the body of every loop in the graph, so a request cannot
 *   name ordinary nodes as loop bodies and hide them from `params`.
 * - `previousFrom`: when the segment right before this one runs on the
 *   server, the node whose result the caller must hand on as
 *   `__previousNodeResult` (the runtime sets it from that node's signed result).
 */
export interface SegmentGraph {
  nodes: UIDLWorkflowNode[]
  edges: UIDLWorkflowEdge[]
  /** Every segment of the graph, in the order the runtime executes them. */
  segments: WorkflowSegment[]
}

export interface SegmentBranchGate {
  id: string
  kind: 'if' | 'switch'
  branches: Array<{ when: string; nodeIds: string[] }>
}

export interface SegmentTrust {
  signedNodeIds: string[]
  branchGates: SegmentBranchGate[]
  loopBodies: Record<string, string[]>
  previousFrom: { nodeId: string; fireAndForget: boolean } | null
}

/** A switch branch is taken by a case id; this prefix keeps it apart from 'default'. */
export const SWITCH_CASE_PREFIX = 'case:'

const collectBranch = (startId: string, edges: UIDLWorkflowEdge[], parentId: string): string[] => {
  const seen = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (seen.has(current) || current === parentId) {
      continue
    }
    seen.add(current)
    for (const edge of edges) {
      if (edge.source === current && edge.target !== parentId) {
        queue.push(edge.target)
      }
    }
  }
  return Array.from(seen)
}

const collectLoopBody = (loopId: string, edges: UIDLWorkflowEdge[]): string[] => {
  const bodyEdge = edges.find((e) => e.source === loopId && e.sourceHandle === 'loop')
  if (!bodyEdge) {
    return []
  }
  const body = new Set<string>()
  const queue = [bodyEdge.target]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (body.has(current) || current === loopId) {
      continue
    }
    body.add(current)
    for (const edge of edges) {
      if (
        edge.source === current &&
        (edge.sourceHandle === 'loop-body-out' || !edge.sourceHandle) &&
        edge.target !== loopId
      ) {
        queue.push(edge.target)
      }
    }
  }
  return Array.from(body)
}

const branchKey = (edge: UIDLWorkflowEdge, kind: 'if' | 'switch'): string | null => {
  if (kind === 'if') {
    return edge.sourceHandle === 'true' || edge.sourceHandle === 'false' ? edge.sourceHandle : null
  }
  if (edge.sourceHandle === 'default') {
    return 'default'
  }
  const caseId = (edge.data as { caseId?: unknown } | undefined)?.caseId
  return edge.sourceHandle === 'switch' && typeof caseId === 'string'
    ? SWITCH_CASE_PREFIX + caseId
    : null
}

const lastNodeByStep = (segment: WorkflowSegment): UIDLWorkflowNode | undefined =>
  segment.nodes
    .slice()
    .sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0))
    .pop()

export const buildSegmentTrust = (segment: WorkflowSegment, graph: SegmentGraph): SegmentTrust => {
  const inSegment = new Set(segment.nodes.map((n) => n.id))
  const serverNodeIds = new Set<string>()
  for (const seg of graph.segments) {
    if (seg.env === 'server') {
      seg.nodes.forEach((n) => serverNodeIds.add(n.id))
    }
  }

  const signedNodeIds = Array.from(serverNodeIds).filter((id) => !inSegment.has(id))

  const branchGates: SegmentBranchGate[] = []
  for (const node of graph.nodes) {
    const kind =
      node.type === 'general-if-statement' ? 'if' : node.type === 'general-switch' ? 'switch' : null
    if (!kind || inSegment.has(node.id) || !serverNodeIds.has(node.id)) {
      continue
    }
    const branches: SegmentBranchGate['branches'] = []
    for (const edge of graph.edges) {
      if (edge.source !== node.id) {
        continue
      }
      const when = branchKey(edge, kind)
      if (!when) {
        continue
      }
      const nodeIds = collectBranch(edge.target, graph.edges, node.id).filter((id) =>
        inSegment.has(id)
      )
      if (nodeIds.length > 0) {
        branches.push({ when, nodeIds })
      }
    }
    if (branches.length > 0) {
      branchGates.push({ id: node.id, kind, branches })
    }
  }

  const loopBodies: Record<string, string[]> = {}
  for (const node of graph.nodes) {
    if (node.type === 'general-loop') {
      loopBodies[node.id] = collectLoopBody(node.id, graph.edges)
    }
  }

  const index = graph.segments.findIndex((s) => s.id === segment.id)
  const before = index > 0 ? graph.segments[index - 1] : null
  const beforeLast = before && before.env === 'server' ? lastNodeByStep(before) : undefined
  const previousFrom =
    before && beforeLast
      ? {
          nodeId: beforeLast.id,
          fireAndForget: isFireAndForgetSegment(before),
        }
      : null

  return { signedNodeIds, branchGates, loopBodies, previousFrom }
}
