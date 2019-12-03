import * as types from '@babel/types'
import { UIDLStateDefinition, UIDLPropDefinition, UIDLDependency } from '@teleporthq/teleport-types'

export interface LitHTMLGenerationParams {
  propDefinitions: Record<string, UIDLPropDefinition>
  stateDefinitions: Record<string, UIDLStateDefinition>
  nodesLookup: Record<string, types.JSXElement>
  dependencies: Record<string, UIDLDependency>
}

export type NodeToLitHTML<NodeType> = (node: NodeType, params: LitHTMLGenerationParams) => string
