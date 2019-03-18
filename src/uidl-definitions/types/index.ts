export interface ProjectUIDL {
  $schema?: string
  name: string
  globals: {
    settings: {
      title: string
      language: string
    }
    meta: Array<Record<string, string>>
    assets: GlobalAsset[]
    manifest?: WebManifest
    variables?: Record<string, string>
  }
  root: ComponentUIDL
  components?: Record<string, ComponentUIDL>
}

export interface GlobalAsset {
  type: string
  path?: string
  content?: string
  meta?: Record<string, any>
}

export interface ComponentUIDL {
  $schema?: string
  name: string
  content: ContentNode
  meta?: Record<string, any>
  propDefinitions?: Record<string, PropDefinition>
  stateDefinitions?: Record<string, StateDefinition>
}

export interface PropDefinition {
  type: string
  defaultValue?: string | number | boolean | any[]
  meta?: Record<string, any>
}

export interface StateDefinition {
  type: string
  defaultValue: string | number | boolean | any[]
  values?: Array<{
    value: string | number | boolean
    meta?: {
      componentName?: string
      path?: string
      fileName?: string
    }
    transitions?: any
  }>
  actions?: string[]
}

export interface ContentNode {
  type: string
  name?: string
  key?: string // internal usage
  states?: StateBranch[]
  repeat?: RepeatDefinition
  dependency?: ComponentDependency
  style?: StyleDefinitions
  attrs?: Record<string, any>
  events?: EventDefinitions
  children?: Array<ContentNode | string>
}

export interface RepeatDefinition {
  content: ContentNode
  dataSource: string | any[]
  meta?: Record<string, any>
}

export interface StateBranch {
  value: string | number | boolean | ConditionalExpression
  content: ContentNode | string
}

export interface EventHandlerStatement {
  type: string
  modifies?: string
  newState?: string | number | boolean
  calls?: string
  args?: Array<string | number | boolean>
}

export interface StyleDefinitions {
  [k: string]: number | string | StyleDefinitions
}

export interface EventDefinitions {
  [k: string]: EventHandlerStatement[]
}

export interface ComponentDependency {
  type: string
  path?: string
  version?: string
  meta?: {
    namedImport?: boolean
    originalName?: string
  }
}

export interface ConditionalExpression {
  conditions: Array<{
    operation: string
    operand?: string | boolean | number
  }>
  matchingCriteria: string
}

export interface WebManifest {
  short_name?: string
  name?: string
  icons?: Array<{ src: string; type: string; sizes: string }>
  start_url?: string
  background_color?: string
  display?: string
  orientation?: string
  scope?: string
  theme_color?: string
}

/* mapping interfaces */

export interface Mapping {
  elements?: Record<string, ElementMapping>
  events?: Record<string, string>
}

export interface ElementMapping {
  type: string
  dependency?: ComponentDependency
  attrs?: Record<string, any>
  children?: Array<ContentNode | string>
  repeat?: {
    content: ContentNode
    dataSource: string
  }
}
