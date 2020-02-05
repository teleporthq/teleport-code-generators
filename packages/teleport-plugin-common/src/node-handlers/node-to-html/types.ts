import {
  UIDLDependency,
  UIDLEventHandlerStatement,
  UIDLElementNode,
} from '@teleporthq/teleport-types'

export interface HTMLTemplateGenerationParams {
  templateLookup: Record<string, any>
  dependencies: Record<string, UIDLDependency>
  dataObject: Record<string, any>
  methodsObject: Record<string, UIDLEventHandlerStatement[]>
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
}

export type NodeToHTML<NodeType, ReturnType> = (
  node: NodeType,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => ReturnType
