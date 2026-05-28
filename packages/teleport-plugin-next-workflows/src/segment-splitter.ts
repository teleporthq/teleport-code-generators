import { UIDLWorkflow, UIDLWorkflowNode, UIDLWorkflowEdge } from '@teleporthq/teleport-types'
import { WorkflowSegment, WorkflowExecutionEnv } from './types'
import { getLoopBodyNodes, getNodeById, getTopologicalOrder } from './graph-utils'
import { nodeRegistry } from './nodes'

const CLIENT_ONLY_NODE_TYPES = new Set([
  'account-login',
  'account-signup',
  'account-logout',
  'account-social-login',
])

const resolveExecutionEnv = (
  node: UIDLWorkflowNode,
  prevEnv: WorkflowExecutionEnv | null
): WorkflowExecutionEnv => {
  if (CLIENT_ONLY_NODE_TYPES.has(node.type)) {
    return 'client'
  }

  // general-custom-node returns an opaque marker from its handler and relies on
  // the client runtime to recognise it and invoke the nested custom node
  // function (which has its own client/server segments). The server handler is
  // a stub — if this node is placed in a server segment the nested workflow
  // never runs and downstream references to its output resolve to the marker.
  if (node.type === 'general-custom-node') {
    return 'client'
  }

  const registered = nodeRegistry[node.type]
  if (registered?.executionEnv === 'client') {
    return 'client'
  }

  if (node.executionEnv === 'client') {
    return 'client'
  }
  if (node.executionEnv === 'server') {
    return 'server'
  }

  if (registered?.executionEnv === 'server') {
    return 'server'
  }

  if (node.type === 'general-custom-js') {
    const ctx = node.config?.context as string | undefined
    if (ctx === 'server') {
      return 'server'
    }
    return 'client'
  }

  if (node.type === 'transform-geolocation') {
    const op = node.config?.operation as string | undefined
    if (op === 'geocode' || op === 'reverse-geocode' || op === 'get-timezone') {
      return 'server'
    }
    if (op === 'current-location') {
      return 'client'
    }
  }

  if (node.type === 'transform-image' || node.type === 'transform-color') {
    const op = node.config?.operation as string | undefined
    if (node.type === 'transform-image') {
      return 'server'
    }
    if (op === 'extract-from-image') {
      return 'server'
    }
  }

  return prevEnv || 'client'
}

const collectErrorBranchNodeIds = (
  errorHandlerNodeId: string,
  nodes: UIDLWorkflowNode[],
  edges: UIDLWorkflowEdge[]
): Set<string> => {
  const ids = new Set<string>()
  const queue: string[] = []
  for (const e of edges) {
    if (e.source === errorHandlerNodeId) {
      queue.push(e.target)
    }
  }
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (ids.has(cur) || !nodeIdSet.has(cur)) {
      continue
    }
    ids.add(cur)
    for (const e of edges) {
      if (e.source === cur) {
        queue.push(e.target)
      }
    }
  }
  return ids
}

export const splitIntoSegments = (workflow: UIDLWorkflow): WorkflowSegment[] => {
  if (workflow.nodes.length === 0) {
    return []
  }

  // Collect every node that belongs to an error-handler branch. Prefer the
  // explicit `workflow.errorHandler` pointer, but also scan for nodes that
  // declare themselves as error handlers (`event-workflow-error` nodes or any
  // node with `config.isErrorHandler === true`) so custom-node workflows —
  // whose pseudo-workflow has no errorHandler pointer wired — still have their
  // error branches excluded from normal execution.
  const errorBranchIds = new Set<string>()
  if (workflow.errorHandler) {
    for (const id of collectErrorBranchNodeIds(
      workflow.errorHandler.nodeId,
      workflow.nodes,
      workflow.edges
    )) {
      errorBranchIds.add(id)
    }
  }
  for (const n of workflow.nodes) {
    const cfg = (n.config || {}) as Record<string, unknown>
    if (n.type === 'event-workflow-error' || cfg.isErrorHandler === true) {
      errorBranchIds.add(n.id)
      for (const id of collectErrorBranchNodeIds(n.id, workflow.nodes, workflow.edges)) {
        errorBranchIds.add(id)
      }
    }
  }

  const mainNodes =
    errorBranchIds.size > 0
      ? workflow.nodes.filter((n) => !errorBranchIds.has(n.id))
      : workflow.nodes
  const mainEdges =
    errorBranchIds.size > 0
      ? workflow.edges.filter((e) => !errorBranchIds.has(e.source) && !errorBranchIds.has(e.target))
      : workflow.edges

  const order = getTopologicalOrder(mainNodes, mainEdges)
  // Loop bodies must execute as a single unit at runtime. The split-by-env
  // walk below would otherwise drop AI/server steps in one segment and the
  // client-only post-processing into another, leaving the loop's body half-
  // executed for every iteration. We reorder the topo so all body nodes sit
  // immediately after their owning loop, and we record a single forced env
  // (server if any body or the loop itself needs server, else client) so the
  // forthcoming env walk emits one segment for the loop + body.
  const { reorderedOrder, forcedEnvByNodeId } = enforceLoopBodyIntegrity(
    order,
    mainNodes,
    mainEdges
  )
  const segments: WorkflowSegment[] = []
  let currentEnv: WorkflowExecutionEnv | null = null
  let currentNodeIds: string[] = []
  let segClientCount = 0
  let segServerCount = 0

  const flushSegment = () => {
    if (currentNodeIds.length === 0 || currentEnv === null) {
      return
    }
    const id = currentEnv === 'client' ? `client-${++segClientCount}` : `server-${++segServerCount}`

    const nodes = currentNodeIds
      .map((nid) => getNodeById(workflow.nodes, nid))
      .filter(Boolean) as UIDLWorkflowNode[]

    const nodeIdSet = new Set(currentNodeIds)
    const edges = workflow.edges.filter(
      (e: UIDLWorkflowEdge) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
    )

    segments.push({ id, env: currentEnv, nodeIds: [...currentNodeIds], nodes, edges })
    currentNodeIds = []
  }

  for (const nodeId of reorderedOrder) {
    const node = getNodeById(workflow.nodes, nodeId)
    if (!node) {
      continue
    }

    const forced = forcedEnvByNodeId.get(nodeId)
    const nodeEnv = forced ?? resolveExecutionEnv(node, currentEnv)

    if (currentEnv !== null && nodeEnv !== currentEnv) {
      flushSegment()
    }
    currentEnv = nodeEnv
    currentNodeIds.push(nodeId)
  }

  flushSegment()
  return segments
}

/**
 * Re-arrange the topological node order so every loop's body nodes sit
 * directly after the loop, and pick a single execution env for the
 * (loop + body) cluster. Nested loops are processed inner-first so the outer
 * loop's body window already contains the inner body in the right order.
 *
 * Why an explicit env override is needed: a body that mixes universal /
 * server / client nodes (e.g. fetch → AI prompt → custom-js with
 * `context: 'client'`) would naturally split into multiple segments. The
 * server-side runtime then sees only the body nodes that landed in the same
 * segment as the loop and silently produces an empty `loop.results`.
 *
 * Server is preferred when any cluster member is server-classified because
 * server segments can host universal nodes and `general-custom-js` (which
 * runs the same string of JS regardless of where it executes); the inverse
 * is not true for AI / HTTP-with-secret nodes. When no member is server, we
 * keep the cluster on the client so DOM- or window-bound bodies still work.
 */
const enforceLoopBodyIntegrity = (
  order: string[],
  mainNodes: UIDLWorkflowNode[],
  mainEdges: UIDLWorkflowEdge[]
): {
  reorderedOrder: string[]
  forcedEnvByNodeId: Map<string, WorkflowExecutionEnv>
} => {
  const forcedEnvByNodeId = new Map<string, WorkflowExecutionEnv>()
  const loopNodes = mainNodes.filter((n) => n.type === 'general-loop')
  if (loopNodes.length === 0) {
    return { reorderedOrder: order, forcedEnvByNodeId }
  }

  // Process inner loops before outer ones: an inner loop's body is a subset
  // of its enclosing loop's body, and we want the outer pass to see the
  // already-clustered inner body as a contiguous block.
  const loopOrder = order.filter((id) => loopNodes.some((n) => n.id === id))

  let working = order.slice()
  for (let li = loopOrder.length - 1; li >= 0; li--) {
    const loopId = loopOrder[li]
    const bodyIds = getLoopBodyNodes(loopId, mainEdges)
    if (bodyIds.length === 0) {
      continue
    }

    const clusterIds = new Set<string>([loopId, ...bodyIds])
    const clusterMembers = Array.from(clusterIds)
      .map((id) => getNodeById(mainNodes, id))
      .filter((n): n is UIDLWorkflowNode => Boolean(n))

    let clusterEnv: WorkflowExecutionEnv = 'client'
    for (const member of clusterMembers) {
      if (resolveExecutionEnv(member, null) === 'server') {
        clusterEnv = 'server'
        break
      }
    }
    for (const member of clusterMembers) {
      forcedEnvByNodeId.set(member.id, clusterEnv)
    }

    // Hoist body nodes (preserving their existing relative order) immediately
    // after the loop. Other nodes keep their relative position.
    const bodyInOrder = working.filter((id) => id !== loopId && clusterIds.has(id))
    const withoutBody = working.filter((id) => id === loopId || !clusterIds.has(id))
    const loopIdxAfterRemoval = withoutBody.indexOf(loopId)
    if (loopIdxAfterRemoval < 0) {
      continue
    }
    working = [
      ...withoutBody.slice(0, loopIdxAfterRemoval + 1),
      ...bodyInOrder,
      ...withoutBody.slice(loopIdxAfterRemoval + 1),
    ]
  }

  return { reorderedOrder: working, forcedEnvByNodeId }
}

export const getServerSegments = (segments: WorkflowSegment[]): WorkflowSegment[] => {
  return segments.filter((s) => s.env === 'server')
}

export const getClientSegments = (segments: WorkflowSegment[]): WorkflowSegment[] => {
  return segments.filter((s) => s.env === 'client')
}
