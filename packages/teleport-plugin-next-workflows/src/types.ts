import { UIDLWorkflowNode, UIDLWorkflowEdge } from '@teleporthq/teleport-types'

export type WorkflowExecutionEnv = 'client' | 'server'

export interface WorkflowSegment {
  id: string
  env: WorkflowExecutionEnv
  nodeIds: string[]
  nodes: UIDLWorkflowNode[]
  edges: UIDLWorkflowEdge[]
  /**
   * The nodes a branch decided outside this segment can start at: those with a
   * predecessor outside it, or with none. Only there may a client's skip mark
   * take effect (see `claimSegmentContext` in the runtime).
   */
  entryNodeIds?: string[]
}

export interface SecretEntry {
  envVarName: string
  value: string
  nodeId: string
  fieldName: string
}

export { NodeHandlerGenerator, IntegrationHandlerGenerator } from './nodes/types'
