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
  node: UIDLNode
  meta?: Record<string, any>
  propDefinitions?: Record<string, UIDLPropDefinition>
  stateDefinitions?: Record<string, UIDLStateDefinition>
}
export interface UIDLPropDefinition {
  type: string
  defaultValue?: string | number | boolean | any[] | object | (() => void)
  meta?: Record<string, any>
}
export interface UIDLStateDefinition {
  type: string
  defaultValue: string | number | boolean | any[] | object | (() => void)
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
export declare type ReferenceType = 'prop' | 'state' | 'local' | 'attr' | 'children'
export interface UIDLDynamicReference {
  type: 'dynamic'
  content: {
    referenceType: ReferenceType
    id: string
  }
}
export interface UIDLStaticValue {
  type: 'static'
  content: string | number | boolean | any[]
}
export interface UIDLSlotNode {
  type: 'slot'
  content: {
    name?: string
    fallback?: UIDLNode
  }
}
export interface UIDLNestedStyleDeclaration {
  type: 'nested-style'
  content: UIDLStyleDefinitions
}
export interface UIDLRepeatNode {
  type: 'repeat'
  content: UIDLRepeatContent
}
export interface UIDLRepeatContent {
  node: UIDLNode
  dataSource: UIDLAttributeValue
  meta?: {
    useIndex?: boolean
    iteratorName?: string
    dataSourceIdentifier?: string
  }
}
export interface UIDLConditionalNode {
  type: 'conditional'
  content: {
    node: UIDLNode
    reference: UIDLDynamicReference
    value?: string | number | boolean
    condition?: UIDLConditionalExpression
  }
}
export interface UIDLConditionalExpression {
  conditions: Array<{
    operation: string
    operand?: string | boolean | number
  }>
  matchingCriteria?: string
}
export interface UIDLElementNode {
  type: 'element'
  content: UIDLElement
}
export interface UIDLElement {
  elementType: string
  name?: string
  key?: string
  dependency?: ComponentDependency
  style?: UIDLStyleDefinitions
  attrs?: Record<string, UIDLAttributeValue>
  events?: EventDefinitions
  children?: UIDLNode[]
}
export declare type UIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRepeatNode
  | UIDLElementNode
  | UIDLConditionalNode
  | UIDLSlotNode
export declare type UIDLAttributeValue = UIDLDynamicReference | UIDLStaticValue
export declare type UIDLStyleValue = UIDLAttributeValue | UIDLNestedStyleDeclaration
export declare type UIDLStyleDefinitions = Record<string, UIDLStyleValue>
export declare type EventDefinitions = Record<string, EventHandlerStatement[]>
export interface EventHandlerStatement {
  type: string
  modifies?: string
  newState?: string | number | boolean
  calls?: string
  args?: Array<string | number | boolean>
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
export interface WebManifest {
  short_name?: string
  name?: string
  icons?: Array<{
    src: string
    type: string
    sizes: string
  }>
  start_url?: string
  background_color?: string
  display?: string
  orientation?: string
  scope?: string
  theme_color?: string
}
export interface Mapping {
  elements?: Record<string, UIDLElement>
  events?: Record<string, string>
}
