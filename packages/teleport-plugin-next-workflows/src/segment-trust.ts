import { UIDLWorkflowEdge, UIDLWorkflowNode } from '@teleporthq/teleport-types'
import { isFireAndForgetSegment } from './await-result'
import { WorkflowSegment } from './types'
import { collectMessageTrust, MessageTrust } from './nodes/email/message-trust'
import { isOutboundMessageNodeType } from './nodes/general/visitor-request'

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
 *
 * What a signature binds (see the server runtime): the workflow (`workflowId`),
 * the segment that produced the result (`signedBy`, and `segmentId` for this
 * route's own), the run it belongs to and when it was made. A run is opened by
 * the first server segment of the graph (`opensRun`), which never adopts one a
 * request names; every later segment continues the run its request carries.
 *
 * `session` says which of the visitor's identity this route reads, so it is
 * taken from the session cookie on the server and never from the request:
 * - `identityNodes`: the graph's current-user readers (`account-get-current`,
 *   `account-refresh-session`). They run in the browser; the route rebuilds
 *   their result from the session.
 * - `identityReads`: the `data-select` / `data-count` nodes of this segment
 *   filtered by the visitor's identity, with those columns. Without an
 *   identity (a guest) such a read matches nothing, never the whole table.
 * Absent when the segment reads no identity.
 */
export interface SegmentGraph {
  /** The workflow (or custom node) the graph belongs to. */
  id?: string
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

export interface SegmentSessionNeeds {
  identityNodes: Record<string, string>
  identityReads: Record<string, string[]>
}

export interface SegmentTrust {
  signedNodeIds: string[]
  signedBy: Record<string, string>
  branchGates: SegmentBranchGate[]
  loopBodies: Record<string, string[]>
  previousFrom: { nodeId: string; fireAndForget: boolean } | null
  workflowId: string
  segmentId: string
  opensRun: boolean
  session?: SegmentSessionNeeds
  /**
   * Only for a segment with an email/SMS node: the graph's node results the
   * send guard may trust (owner recipients, trusted HTML; see
   * nodes/email/message-trust).
   */
  messageTrust?: MessageTrust
}

/** The nodes whose result is the signed-in visitor (see `session` above). */
export const IDENTITY_NODE_TYPES: ReadonlySet<string> = new Set([
  'account-get-current',
  'account-refresh-session',
  'account-login',
])

const IDENTITY_READ_NODE_TYPES: ReadonlySet<string> = new Set(['data-select', 'data-count'])

/** A `{{Current User.<field>}}` / `{{currentUser.<field>}}` / `{{state.currentUser…}}` token. */
const CURRENT_USER_TOKEN = /\{\{\s*(?:Current User|currentUser|state\.currentUser)\b/

/** Any mention of the visitor's identity or of the page state that carries it. */
const READS_IDENTITY = /Current User|currentUser|__stateValues/

const asContextRef = (value: unknown): { nodeId: string; path: unknown[] } | null => {
  const ref = value as { type?: unknown; nodeId?: unknown; path?: unknown } | null
  return ref && typeof ref === 'object' && ref.type === 'workflowContext'
    ? {
        nodeId: typeof ref.nodeId === 'string' ? ref.nodeId : '',
        path: Array.isArray(ref.path) ? ref.path : [],
      }
    : null
}

/** Whether a filter value names the visitor: a current-user token or a reader's result. */
/** The node ids the inline context chips of a rich-text value point at. */
const chipNodeIds = (value: string): string[] => {
  const ids: string[] = []
  const chip = /data-ctx-node-id=(["'])([^"']*)\1/g
  let match = chip.exec(value)
  while (match) {
    ids.push(match[2])
    match = chip.exec(value)
  }
  return ids
}

const isIdentityValue = (value: unknown, identityNodes: Record<string, string>): boolean => {
  if (typeof value === 'string') {
    return (
      CURRENT_USER_TOKEN.test(value) ||
      chipNodeIds(value).some((id) => Object.prototype.hasOwnProperty.call(identityNodes, id))
    )
  }
  if (Array.isArray(value)) {
    return value.some((part) => isIdentityValue(part, identityNodes))
  }
  const ref = asContextRef(value)
  if (!ref) {
    return false
  }
  if (Object.prototype.hasOwnProperty.call(identityNodes, ref.nodeId)) {
    return true
  }
  // A read of the page state's `currentUser`, wherever the bag is reached from.
  const walk = [ref.nodeId, ...ref.path]
  for (let i = 0; i < walk.length - 1; i++) {
    if (walk[i] === '__stateValues' && walk[i + 1] === 'currentUser') {
      return true
    }
  }
  return false
}

const identityColumnsOf = (
  node: UIDLWorkflowNode,
  identityNodes: Record<string, string>
): string[] => {
  const filters = (node.config as { filters?: unknown } | undefined)?.filters
  if (!Array.isArray(filters)) {
    return []
  }
  const columns: string[] = []
  for (const filter of filters) {
    const f = (filter || {}) as Record<string, unknown>
    // Read as data-select reads a filter: `destination` before `value`.
    const column = f.column || f.source || f.field
    const value = f.destination !== undefined ? f.destination : f.value
    if (typeof column === 'string' && column && isIdentityValue(value, identityNodes)) {
      if (columns.indexOf(column) === -1) {
        columns.push(column)
      }
    }
  }
  return columns
}

const buildSessionNeeds = (
  segment: WorkflowSegment,
  graph: SegmentGraph
): SegmentSessionNeeds | undefined => {
  const identityNodes: Record<string, string> = {}
  for (const node of graph.nodes) {
    if (IDENTITY_NODE_TYPES.has(node.type)) {
      identityNodes[node.id] = node.type
    }
  }
  const identityReads: Record<string, string[]> = {}
  let readsIdentity = Object.keys(identityNodes).length > 0
  for (const node of segment.nodes) {
    if (IDENTITY_READ_NODE_TYPES.has(node.type)) {
      const columns = identityColumnsOf(node, identityNodes)
      if (columns.length > 0) {
        identityReads[node.id] = columns
      }
    }
    if (!readsIdentity && READS_IDENTITY.test(JSON.stringify(node.config || {}))) {
      readsIdentity = true
    }
  }
  return readsIdentity || Object.keys(identityReads).length > 0
    ? { identityNodes, identityReads }
    : undefined
}

/**
 * The graph's id when the caller names it; otherwise one derived from its
 * node ids, so two different graphs never share signatures.
 */
const graphIdOf = (graph: SegmentGraph): string => {
  if (typeof graph.id === 'string' && graph.id) {
    return graph.id
  }
  const text = graph.nodes
    .map((n) => n.id)
    .sort()
    .join('|')
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    // tslint:disable-next-line:no-bitwise
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  // tslint:disable-next-line:no-bitwise
  return `graph-${(hash >>> 0).toString(16)}-${graph.nodes.length}`
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
  const producedBy: Record<string, string> = {}
  for (const seg of graph.segments) {
    if (seg.env === 'server') {
      seg.nodes.forEach((n) => {
        serverNodeIds.add(n.id)
        producedBy[n.id] = seg.id
      })
    }
  }

  const signedNodeIds = Array.from(serverNodeIds).filter((id) => !inSegment.has(id))
  const signedBy: Record<string, string> = {}
  for (const id of signedNodeIds) {
    signedBy[id] = producedBy[id]
  }

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

  const firstServer = graph.segments.find((s) => s.env === 'server')
  const session = buildSessionNeeds(segment, graph)

  return {
    signedNodeIds,
    signedBy,
    branchGates,
    loopBodies,
    previousFrom,
    workflowId: graphIdOf(graph),
    segmentId: segment.id,
    opensRun: !firstServer || firstServer.id === segment.id,
    ...(session ? { session } : {}),
    ...(segment.nodes.some((n) => isOutboundMessageNodeType(n.type))
      ? {
          messageTrust: collectMessageTrust({
            nodes: graph.nodes,
            edges: graph.edges,
            serverNodeIds,
          }),
        }
      : {}),
  }
}
