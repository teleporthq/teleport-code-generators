import { ComponentDependency, UIDLEventHandlerStatement } from '@teleporthq/teleport-types'

export interface HTMLTemplateGenerationParams {
  templateLookup: Record<string, any>
  dependencies: Record<string, ComponentDependency>
  dataObject: Record<string, any>
  methodsObject: Record<string, UIDLEventHandlerStatement[]>
}

export interface HTMLTemplateSyntax {
  interpolation: (value: string) => string
  valueBinding: (value: string) => string
  eventBinding: (value: string) => string
  eventEmmitter: (value: string) => string
  conditionalAttr: string
  repeatAttr: string
  repeatIterator: (iteratorName: string, iteratedCollection: string, useIndex: boolean) => string
}
