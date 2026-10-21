import { UIDLWorkflowNode, UIDLWorkflowEdge, UIDLWorkflows } from '@teleporthq/teleport-types'

export const getNodeById = (
  nodes: UIDLWorkflowNode[],
  nodeId: string
): UIDLWorkflowNode | undefined => {
  return nodes.find((n) => n.id === nodeId)
}

export const getNodeDependencies = (nodeId: string, edges: UIDLWorkflowEdge[]): string[] => {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source)
}

export const getNodeChildren = (nodeId: string, edges: UIDLWorkflowEdge[]): string[] => {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target)
}

export const getEdgesFrom = (nodeId: string, edges: UIDLWorkflowEdge[]): UIDLWorkflowEdge[] => {
  return edges.filter((e) => e.source === nodeId)
}

export const getEdgesTo = (nodeId: string, edges: UIDLWorkflowEdge[]): UIDLWorkflowEdge[] => {
  return edges.filter((e) => e.target === nodeId)
}

/**
 * Recursively collect every workflow-context node id a config references, i.e.
 * the ids inside `{ type: 'workflowContext', nodeId: '<id>', path: [...] }`
 * objects embedded anywhere in a node's config (filter values, column mappings,
 * loop collections, custom-js params, …).
 */
export const collectWorkflowContextNodeIds = (value: unknown, out: Set<string>): void => {
  if (!value || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectWorkflowContextNodeIds(item, out))
    return
  }
  const record = value as Record<string, unknown>
  if (record.type === 'workflowContext' && typeof record.nodeId === 'string') {
    out.add(record.nodeId)
  }
  Object.values(record).forEach((child) => collectWorkflowContextNodeIds(child, out))
}

/**
 * The edge that sends a loop body back to its loop for the next item. The loop
 * does not wait for it: counted as a dependency it left the loop, and every
 * node after it, waiting forever.
 */
const isLoopBackEdge = (edge: UIDLWorkflowEdge): boolean => edge.targetHandle === 'loop-back'

/**
 * Where a node runs once the segment splitter places it, or `null` for a node
 * that runs wherever the node before it ran (an if-statement), so it never
 * forces a switch between browser and server.
 */
export type ExecutionSide = 'client' | 'server'
export type ExecutionSideOf = (node: UIDLWorkflowNode) => ExecutionSide | null

/**
 * Every dependency each node waits for: the source of each edge into it (but a
 * loop's back edge) and every node whose output it reads through a
 * `workflowContext` reference. Listed per SOURCE, in edge order then reference
 * order — the order the topological sort below releases them in.
 */
export const getDependents = (
  nodes: UIDLWorkflowNode[],
  edges: UIDLWorkflowEdge[]
): Record<string, string[]> => {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const adjacency: Record<string, string[]> = {}
  nodeIds.forEach((id) => {
    adjacency[id] = []
  })

  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && !isLoopBackEdge(edge)) {
      adjacency[edge.source].push(edge.target)
    }
  })

  // Virtual dependency edges from IMPLICIT data dependencies: a node that
  // consumes another node's output via a `workflowContext` reference in its
  // config MUST run after that node, even when no explicit edge wires them.
  // Without this, a `data-create-item` that reads a `state-get-local-state`
  // result only through its columnMappings is treated as in-degree 0 and can be
  // ordered (and segmented) BEFORE the state read — so on the server it writes
  // null for that column (run 0a5f554e: `titles.type_field` NOT-NULL violation;
  // the "Add Asset" draft rows came through as "N/A" for the same reason).
  // Control-flow nodes (loop/if/switch/parallel) are skipped — their outputs
  // (e.g. a loop's `currentItem`) are scoped by dedicated edge handles, not a
  // linear data dependency. Edges are added to this LOCAL graph only (never to
  // `workflow.edges`), so loop/branch extraction elsewhere is unaffected.
  const nodeTypeById = new Map(nodes.map((n) => [n.id, n.type]))
  nodes.forEach((node) => {
    const referencedIds = new Set<string>()
    collectWorkflowContextNodeIds(node.config, referencedIds)
    referencedIds.forEach((refId) => {
      if (refId === node.id || !nodeIds.has(refId)) {
        return
      }
      if (isControlFlowNode(nodeTypeById.get(refId) || '')) {
        return
      }
      if (adjacency[refId].includes(node.id)) {
        return
      }
      adjacency[refId].push(node.id)
    })
  })

  return adjacency
}

/**
 * Every node reachable from `startId` without passing through `parentId` or a
 * loop's back edge: what the runtime skips when `parentId` does not take the
 * branch starting at `startId`.
 */
const collectBranchNodeIds = (
  startId: string,
  targetsBySource: Map<string, string[]>,
  parentId: string
): Set<string> => {
  const reached = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (reached.has(current) || current === parentId) {
      continue
    }
    reached.add(current)
    queue.push(...(targetsBySource.get(current) || []))
  }
  return reached
}

/**
 * Whether two nodes can never both run: they lie on different branches of the
 * same if-statement or switch, and the runtime skips everything reachable from
 * the branch it did not take.
 */
export const getNeverRunTogether = (
  nodes: UIDLWorkflowNode[],
  edges: UIDLWorkflowEdge[]
): ((a: string, b: string) => boolean) => {
  const targetsBySource = new Map<string, string[]>()
  edges.forEach((edge) => {
    if (!isLoopBackEdge(edge)) {
      targetsBySource.set(edge.source, [...(targetsBySource.get(edge.source) || []), edge.target])
    }
  })
  const branchesByNodeId = new Map<string, Array<{ gateId: string; branch: string }>>()
  nodes.forEach((gate) => {
    const branchTargets =
      gate.type === 'general-if-statement'
        ? Object.entries(getIfBranches(gate.id, edges))
        : gate.type === 'general-switch'
        ? getSwitchCases(gate.id, edges).map(({ caseId, targetId }) => [caseId, targetId])
        : []
    branchTargets.forEach(([branch, targetId]) => {
      if (!targetId) {
        return
      }
      collectBranchNodeIds(targetId, targetsBySource, gate.id).forEach((id) => {
        const branches = branchesByNodeId.get(id) || []
        branches.push({ gateId: gate.id, branch })
        branchesByNodeId.set(id, branches)
      })
    })
  })
  return (a, b) => {
    const branchesOfB = branchesByNodeId.get(b) || []
    return (branchesByNodeId.get(a) || []).some((x) =>
      branchesOfB.some((y) => x.gateId === y.gateId && x.branch !== y.branch)
    )
  }
}

/**
 * Kahn's order, the lowest `stepNumber` first among the nodes ready to run.
 *
 * With `sideOf` (the segment splitter), a ready node that stays on the side
 * the previous node ran on may go ahead of lower-step nodes on the other side —
 * one client/server switch fewer, so one server round trip fewer — but only of
 * nodes it never runs together with. A refusal branch's toast waits for the
 * main chain's server steps; two steps that both run keep their order, which
 * custom JavaScript reads `params` by.
 */
export const getTopologicalOrder = (
  nodes: UIDLWorkflowNode[],
  edges: UIDLWorkflowEdge[],
  sideOf?: ExecutionSideOf
): string[] => {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const adjacency = getDependents(nodes, edges)
  const inDegree: Record<string, number> = {}
  const nodeIdArr = Array.from(nodeIds)
  nodeIdArr.forEach((id) => {
    inDegree[id] = 0
  })
  nodeIdArr.forEach((id) =>
    adjacency[id].forEach((dependent) => {
      inDegree[dependent]++
    })
  )

  const queue: string[] = []
  nodeIdArr.forEach((id) => {
    if (inDegree[id] === 0) {
      queue.push(id)
    }
  })

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const neverRunTogether = sideOf ? getNeverRunTogether(nodes, edges) : null
  let currentSide: ExecutionSide | null = null
  const staysOnCurrentSide = (id: string): boolean => {
    const side = sideOf(nodeById.get(id))
    return side === null || side === currentSide
  }
  const nextIndex = (): number => {
    if (!sideOf || currentSide === null || staysOnCurrentSide(queue[0])) {
      return 0
    }
    const index = queue.findIndex(
      (id, i) =>
        i > 0 &&
        staysOnCurrentSide(id) &&
        queue.slice(0, i).every((ahead) => neverRunTogether(id, ahead))
    )
    return Math.max(index, 0)
  }

  const order: string[] = []
  while (queue.length > 0) {
    queue.sort((a, b) => {
      const nodeA = nodes.find((n) => n.id === a)
      const nodeB = nodes.find((n) => n.id === b)
      return (nodeA?.stepNumber || 0) - (nodeB?.stepNumber || 0)
    })
    const [current] = queue.splice(nextIndex(), 1)
    currentSide = (sideOf && sideOf(nodeById.get(current))) || currentSide
    order.push(current)

    for (const neighbor of adjacency[current] || []) {
      inDegree[neighbor]--
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor)
      }
    }
  }

  if (order.length < nodeIds.size) {
    const remaining = Array.from(nodeIds).filter((id) => !order.includes(id))
    remaining.sort((a, b) => {
      const nodeA = nodes.find((n) => n.id === a)
      const nodeB = nodes.find((n) => n.id === b)
      return (nodeA?.stepNumber || 0) - (nodeB?.stepNumber || 0)
    })
    order.push(...remaining)
  }

  return order
}

export const getLoopBodyNodes = (loopNodeId: string, edges: UIDLWorkflowEdge[]): string[] => {
  const loopEntryEdge = edges.find((e) => e.source === loopNodeId && e.sourceHandle === 'loop')
  if (!loopEntryEdge) {
    return []
  }

  const bodyNodes: string[] = []
  const visited = new Set<string>()
  const queue = [loopEntryEdge.target]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current) || current === loopNodeId) {
      continue
    }
    visited.add(current)
    bodyNodes.push(current)

    const outEdges = getEdgesFrom(current, edges)
    for (const edge of outEdges) {
      if (edge.sourceHandle === 'loop-body-out' && edge.targetHandle === 'loop-back') {
        continue
      }
      if (edge.target !== loopNodeId) {
        queue.push(edge.target)
      }
    }
  }

  return bodyNodes
}

export const getParallelBranches = (
  parallelNodeId: string,
  edges: UIDLWorkflowEdge[]
): { branchStartIds: string[]; successTargetId?: string; errorTargetId?: string } => {
  const branchEdges = edges.filter(
    (e) => e.source === parallelNodeId && e.sourceHandle === 'parallel'
  )
  const successEdge = edges.find((e) => e.source === parallelNodeId && e.sourceHandle === 'success')
  const errorEdge = edges.find((e) => e.source === parallelNodeId && e.sourceHandle === 'error')

  return {
    branchStartIds: branchEdges.map((e) => e.target),
    successTargetId: successEdge?.target,
    errorTargetId: errorEdge?.target,
  }
}

export const getSwitchCases = (
  switchNodeId: string,
  edges: UIDLWorkflowEdge[]
): Array<{ caseId: string; targetId: string }> => {
  const caseEdges = edges.filter((e) => e.source === switchNodeId && e.sourceHandle === 'switch')
  const defaultEdge = edges.find((e) => e.source === switchNodeId && e.sourceHandle === 'default')

  const cases = caseEdges.map((e) => ({
    caseId: (e.data?.caseId as string) || 'unknown',
    targetId: e.target,
  }))

  if (defaultEdge) {
    cases.push({ caseId: 'default', targetId: defaultEdge.target })
  }

  return cases
}

export const getIfBranches = (
  ifNodeId: string,
  edges: UIDLWorkflowEdge[]
): { trueTargetId?: string; falseTargetId?: string } => {
  const trueEdge = edges.find((e) => e.source === ifNodeId && e.sourceHandle === 'true')
  const falseEdge = edges.find((e) => e.source === ifNodeId && e.sourceHandle === 'false')

  return {
    trueTargetId: trueEdge?.target,
    falseTargetId: falseEdge?.target,
  }
}

export const getLoopExitTarget = (
  loopNodeId: string,
  edges: UIDLWorkflowEdge[]
): string | undefined => {
  const exitEdge = edges.find((e) => e.source === loopNodeId && e.sourceHandle === 'exit')
  return exitEdge?.target
}

export const collectUsedNodeTypes = (workflows: UIDLWorkflows): Set<string> => {
  const types = new Set<string>()

  const allWorkflows = workflows.workflows as Record<string, { nodes: UIDLWorkflowNode[] }>
  Object.values(allWorkflows).forEach((wf) => {
    wf.nodes.forEach((node: UIDLWorkflowNode) => {
      types.add(node.type)
    })
  })

  if (workflows.customNodes) {
    const customNodes = workflows.customNodes as Record<string, { nodes: UIDLWorkflowNode[] }>
    Object.values(customNodes).forEach((cn) => {
      cn.nodes.forEach((node: UIDLWorkflowNode) => {
        types.add(node.type)
      })
    })
  }

  return types
}

export const AI_NODE_TYPES = new Set([
  'ai-custom-prompt',
  'ai-sentiment-analysis',
  'ai-summarization',
  'ai-text-classifier',
  'ai-text-transform',
  'ai-detect-language',
])

export const isStreamingAINode = (node: UIDLWorkflowNode): boolean => {
  return AI_NODE_TYPES.has(node.type) && node.config?.streaming === true
}

export const getStreamingBranches = (
  nodeId: string,
  edges: UIDLWorkflowEdge[]
): { onStreamTargetId?: string; onEndTargetId?: string } => {
  const onStreamEdge = edges.find((e) => e.source === nodeId && e.sourceHandle === 'on-stream')
  const onEndEdge = edges.find((e) => e.source === nodeId && e.sourceHandle === 'on-end')
  return {
    onStreamTargetId: onStreamEdge?.target,
    onEndTargetId: onEndEdge?.target,
  }
}

export const isControlFlowNode = (nodeType: string): boolean => {
  return ['general-if-statement', 'general-switch', 'general-loop', 'general-parallel'].includes(
    nodeType
  )
}

export const isTerminalNode = (nodeType: string): boolean => {
  return [
    'navigation-go-to-page',
    'navigation-navigate-to-url',
    'navigation-refresh-page',
    'navigation-go-back',
    'account-signup',
    'account-login',
    'account-social-login',
    'account-logout',
    'account-delete-current',
    'payment-charge-user',
  ].includes(nodeType)
}

export const REALTIME_NODE_TYPES = new Set([
  'realtime-on-channel-message',
  'realtime-on-channel-event',
  'realtime-on-user-joined-channel',
  'realtime-on-user-left-channel',
  'realtime-join-channel',
  'realtime-leave-channel',
  'realtime-list-channels',
  'realtime-list-channel-members',
  'realtime-send-channel-message',
  'realtime-send-channel-event',
])

export const REALTIME_TRIGGER_TYPES = new Set([
  'realtime-on-channel-message',
  'realtime-on-channel-event',
  'realtime-on-user-joined-channel',
  'realtime-on-user-left-channel',
])

export const projectUsesRealtime = (workflows: UIDLWorkflows): boolean => {
  if (!workflows || !workflows.workflows) {
    return false
  }

  const allWorkflows = workflows.workflows as Record<
    string,
    { trigger: { type: string }; nodes: UIDLWorkflowNode[] }
  >

  for (const wf of Object.values(allWorkflows)) {
    if (REALTIME_NODE_TYPES.has(wf.trigger.type)) {
      return true
    }
    for (const node of wf.nodes) {
      if (REALTIME_NODE_TYPES.has(node.type)) {
        return true
      }
    }
  }

  if (workflows.customNodes) {
    const customNodes = workflows.customNodes as Record<string, { nodes: UIDLWorkflowNode[] }>
    for (const cn of Object.values(customNodes)) {
      for (const node of cn.nodes) {
        if (REALTIME_NODE_TYPES.has(node.type)) {
          return true
        }
      }
    }
  }

  return false
}

export const collectUsedRealtimeActionTypes = (workflows: UIDLWorkflows): Set<string> => {
  const types = new Set<string>()
  if (!workflows || !workflows.workflows) {
    return types
  }

  const realtimeActionTypes = new Set([
    'realtime-join-channel',
    'realtime-leave-channel',
    'realtime-list-channels',
    'realtime-list-channel-members',
    'realtime-send-channel-message',
    'realtime-send-channel-event',
  ])

  const allWorkflows = workflows.workflows as Record<string, { nodes: UIDLWorkflowNode[] }>
  for (const wf of Object.values(allWorkflows)) {
    for (const node of wf.nodes) {
      if (realtimeActionTypes.has(node.type)) {
        types.add(node.type)
      }
    }
  }

  if (workflows.customNodes) {
    const customNodes = workflows.customNodes as Record<string, { nodes: UIDLWorkflowNode[] }>
    for (const cn of Object.values(customNodes)) {
      for (const node of cn.nodes) {
        if (realtimeActionTypes.has(node.type)) {
          types.add(node.type)
        }
      }
    }
  }

  return types
}
