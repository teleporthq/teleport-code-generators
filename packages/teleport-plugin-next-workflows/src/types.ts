import { UIDLWorkflowNode, UIDLWorkflowEdge } from '@teleporthq/teleport-types'

export type WorkflowExecutionEnv = 'client' | 'server'

export interface WorkflowSegment {
  id: string
  env: WorkflowExecutionEnv
  nodeIds: string[]
  nodes: UIDLWorkflowNode[]
  edges: UIDLWorkflowEdge[]
}

export interface SecretEntry {
  envVarName: string
  value: string
  nodeId: string
  fieldName: string
}

export { NodeHandlerGenerator, IntegrationHandlerGenerator } from './nodes/types'
