import {
  UIDLDependency,
  UIDLEventHandlerStatement,
  UIDLElementNode,
  UIDLPropDefinition,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'

export interface HTMLTemplateGenerationParams {
  // tslint:disable-next-line no-any
  templateLookup: Record<string, any>
  dependencies: Record<string, UIDLDependency>
  // tslint:disable-next-line no-any
  dataObject: Record<string, any>
  methodsObject: Record<string, UIDLEventHandlerStatement[]>
  propDefinitions: Record<string, UIDLPropDefinition>
  stateDefinitions: Record<string, UIDLStateDefinition>
}

export interface HTMLTemplateSyntax {
  interpolation?: (value: string) => string
  valueBinding?: (value: string, node?: UIDLElementNode) => string
  eventBinding?: (value: string) => string
  eventHandlersBindingMode?: (value: string) => string
  eventEmmitter?: (value: string) => string
  conditionalAttr?: string
  repeatAttr?: string
  repeatIterator?: (iteratorName: string, iteratedCollection: string, useIndex: boolean) => string
  customElementTagName?: (value: string) => string
  dependencyHandling?: 'import' | 'ignore'
  domHTMLInjection?: string
  slotBinding?: string
  slotTagName?: string
}

export type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => ReturnType
