import { ComponentDependency, EventHandlerStatement } from '@teleporthq/teleport-types'

export interface HTMLTemplateGenerationParams {
  templateLookup: Record<string, any>
  dependencies: Record<string, ComponentDependency>
  dataObject: Record<string, any>
  methodsObject: Record<string, EventHandlerStatement[]>
}
