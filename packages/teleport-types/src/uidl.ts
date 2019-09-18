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
  type: 'script' | 'style' | 'font' | 'canonical' | 'icon'
  path?: string
  content?: string
  options?: {
    async?: boolean
    defer?: boolean
    target?: string
    iconType?: string
    iconSizes?: string
  }
}

export interface ComponentUIDL {
  $schema?: string
  name: string
  node: UIDLElementNode
  propDefinitions?: Record<string, UIDLPropDefinition>
  stateDefinitions?: Record<string, UIDLStateDefinition>
  outputOptions?: {
    fileName?: string
    styleFileName?: string
    templateFileName?: string
    moduleName?: string
    folderPath?: string[]
  }
  seo?: UIDLComponentSEO
}

export interface UIDLComponentSEO {
  title?: string
  metaTags?: Array<Record<string, string>>
  assets?: GlobalAsset[]
}

export interface UIDLPropDefinition {
  type: string
  defaultValue?: string | number | boolean | any[] | object | (() => void)
  isRequired?: boolean
}

export interface UIDLStateDefinition {
  type: string
  defaultValue: string | number | boolean | any[] | object | (() => void)
  values?: Array<{
    value: string | number | boolean
    pageOptions?: UIDLPageOptions // Used when the StateDefinition is used as the router
    seo?: UIDLComponentSEO
  }>
}

export interface UIDLPageOptions {
  componentName?: string
  navLink?: string
  fileName?: string
}

export type ReferenceType = 'prop' | 'state' | 'local' | 'attr' | 'children'

export interface UIDLDynamicReference {
  type: 'dynamic'
  content: {
    referenceType: ReferenceType
    id: string
  }
}

export interface UIDLStaticValue {
  type: 'static'
  content: string | number | boolean | any[] // any[] for data sources
}

export interface UIDLSlotNode {
  type: 'slot'
  content: {
    name?: string
    fallback?: UIDLElementNode | UIDLStaticValue | UIDLDynamicReference
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
  node: UIDLElementNode
  dataSource: UIDLAttributeValue
  meta?: UIDLRepeatMeta
}

export interface UIDLRepeatMeta {
  useIndex?: boolean
  iteratorName?: string
  dataSourceIdentifier?: string
  iteratorKey?: string
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
  key?: string // internal usage
  dependency?: UIDLDependency
  style?: UIDLStyleDefinitions
  attrs?: Record<string, UIDLAttributeValue>
  events?: UIDLEventDefinitions
  children?: UIDLNode[]
}

export type UIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRepeatNode
  | UIDLElementNode
  | UIDLConditionalNode
  | UIDLSlotNode

export type UIDLAttributeValue = UIDLDynamicReference | UIDLStaticValue

export type UIDLStyleValue = UIDLAttributeValue | UIDLNestedStyleDeclaration

export type UIDLStyleDefinitions = Record<string, UIDLStyleValue>

export type UIDLEventDefinitions = Record<string, UIDLEventHandlerStatement[]>

export interface UIDLEventHandlerStatement {
  type: string
  modifies?: string
  newState?: string | number | boolean
  calls?: string
  args?: Array<string | number | boolean>
}

export interface UIDLDependency {
  type: 'library' | 'package' | 'local'
  path?: string
  version?: string
  meta?: {
    namedImport?: boolean
    originalName?: string
    importJustPath?: boolean
  }
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

export interface Mapping {
  elements?: Record<string, UIDLElement>
  events?: Record<string, string>
  attributes?: Record<string, string>
}
