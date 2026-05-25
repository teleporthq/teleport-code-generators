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

export const getTopologicalOrder = (
  nodes: UIDLWorkflowNode[],
  edges: UIDLWorkflowEdge[]
): string[] => {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const inDegree: Record<string, number> = {}
  const adjacency: Record<string, string[]> = {}

  const nodeIdArr = Array.from(nodeIds)
  nodeIdArr.forEach((id) => {
    inDegree[id] = 0
    adjacency[id] = []
  })

  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency[edge.source].push(edge.target)
      inDegree[edge.target]++
    }
  })

  const queue: string[] = []
  nodeIdArr.forEach((id) => {
    if (inDegree[id] === 0) {
      queue.push(id)
    }
  })

  const order: string[] = []
  while (queue.length > 0) {
    queue.sort((a, b) => {
      const nodeA = nodes.find((n) => n.id === a)
      const nodeB = nodes.find((n) => n.id === b)
      return (nodeA?.stepNumber || 0) - (nodeB?.stepNumber || 0)
    })
    const current = queue.shift()!
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
