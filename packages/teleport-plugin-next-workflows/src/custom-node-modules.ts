import { UIDLCustomWorkflowNode, UIDLWorkflowNode } from '@teleporthq/teleport-types'

/**
 * Which client module a custom node is emitted into.
 *
 * Every custom node lands in `utils/workflows/custom-nodes.js`, and every page
 * or component whose workflows call ANY custom node imports that whole module.
 * A node only the admin pages call (marked `clientModule: 'admin'` by the
 * GUI) would then ship to every storefront page with an add-to-cart button.
 * Those nodes go to `utils/workflows/custom-nodes-admin.js` instead, which
 * only the pages and components that call them import.
 *
 * A marked node that an unmarked node calls, directly or through other nodes,
 * stays in the shared module: a shared node resolves its nested calls from the
 * shared module's registry alone. A project without marked nodes gets exactly
 * the one shared module it always had.
 */

export const ADMIN_CUSTOM_NODES_MODULE = 'custom-nodes-admin'

type CustomNodes = Record<string, UIDLCustomWorkflowNode> | undefined

const calledCustomNodeIds = (nodes: UIDLWorkflowNode[] | undefined): string[] => {
  const ids: string[] = []
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node && node.type === 'general-custom-node') {
      const customNodeId = ((node.config || {}) as Record<string, unknown>).customNodeId
      if (typeof customNodeId === 'string' && customNodeId) {
        ids.push(customNodeId)
      }
    }
  }
  return ids
}

const isMarkedAdmin = (customNode: UIDLCustomWorkflowNode | undefined): boolean =>
  !!customNode && (customNode as { clientModule?: unknown }).clientModule === 'admin'

/** The ids of the custom nodes emitted into `custom-nodes-admin.js` (empty: no such module). */
export const collectAdminModuleCustomNodeIds = (customNodes: CustomNodes): Set<string> => {
  const all = customNodes || {}
  const marked = Object.keys(all).filter((id) => isMarkedAdmin(all[id]))
  if (marked.length === 0) {
    return new Set<string>()
  }
  // Everything an unmarked node reaches stays in the shared module.
  const reachedFromShared = new Set<string>()
  const pending = Object.keys(all).filter((id) => !isMarkedAdmin(all[id]))
  while (pending.length > 0) {
    const id = pending.pop() as string
    for (const calledId of calledCustomNodeIds(all[id]?.nodes)) {
      if (all[calledId] && !reachedFromShared.has(calledId)) {
        reachedFromShared.add(calledId)
        pending.push(calledId)
      }
    }
  }
  return new Set(marked.filter((id) => !reachedFromShared.has(id)))
}

/** Whether `nodes` call one of `targetIds`, directly or through the custom nodes they call. */
export const callsCustomNodeTransitively = (
  nodes: UIDLWorkflowNode[] | undefined,
  targetIds: Set<string>,
  customNodes: CustomNodes,
  visited: Set<string> = new Set<string>()
): boolean => {
  if (targetIds.size === 0) {
    return false
  }
  for (const calledId of calledCustomNodeIds(nodes)) {
    if (targetIds.has(calledId)) {
      return true
    }
    if (visited.has(calledId)) {
      continue
    }
    visited.add(calledId)
    const called = customNodes ? customNodes[calledId] : undefined
    if (called && callsCustomNodeTransitively(called.nodes, targetIds, customNodes, visited)) {
      return true
    }
  }
  return false
}

/**
 * What a server route (cron, webhook) adds after requiring the shared module
 * when its nodes call a node of the admin module: that module's registry,
 * merged in. Empty for every other route. `rootPrefix` leads to the app root.
 */
export const adminCustomNodesRequireLine = (
  nodes: UIDLWorkflowNode[],
  customNodes: CustomNodes,
  rootPrefix: string
): string => {
  const adminIds = collectAdminModuleCustomNodeIds(customNodes)
  if (!callsCustomNodeTransitively(nodes, adminIds, customNodes)) {
    return ''
  }
  return `try { __customNodes = Object.assign({}, __customNodes, require('${rootPrefix}/utils/workflows/${ADMIN_CUSTOM_NODES_MODULE}')); } catch (_e) {}\n`
}
