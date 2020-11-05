export interface ProjectUIDL {
  name: string
  globals: UIDLGlobalProjectValues
  root: ComponentUIDL
  components?: Record<string, ComponentUIDL>
}

export interface UIDLGlobalProjectValues {
  settings: {
    title: string
    language: string
  }
  customCode?: {
    head?: string
    body?: string
  }
  meta: Array<Record<string, string>>
  assets: UIDLGlobalAsset[]
  manifest?: WebManifest
  variables?: Record<string, string>
}

export interface UIDLGlobalAsset {
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
  name: string
  node: UIDLElementNode
  styleSetDefinitions?: Record<string, UIDLStyleSetDefinition>
  propDefinitions?: Record<string, UIDLPropDefinition>
  importDefinitions?: Record<string, UIDLExternalDependency>
  peerDefinitions?: Record<string, UIDLPeerDependency>
  stateDefinitions?: Record<string, UIDLStateDefinition>
  outputOptions?: UIDLComponentOutputOptions
  seo?: UIDLComponentSEO
}

export interface UIDLComponentOutputOptions {
  componentClassName?: string // needs to be a valid class name
  fileName?: string // needs to be a valid file name
  styleFileName?: string
  templateFileName?: string
  moduleName?: string
  folderPath?: string[]
}

export interface UIDLComponentSEO {
  title?: string
  metaTags?: UIDLMetaTag[]
  assets?: UIDLGlobalAsset[]
}

export type UIDLMetaTag = Record<string, string>

export interface UIDLPropDefinition {
  type: string
  defaultValue?: string | number | boolean | unknown[] | object | (() => void)
  isRequired?: boolean
}

export interface UIDLStyleSetDefinition {
  id: string
  name: string
  type: 'reusable-project-style-map'
  conditions?: UIDLStyleSetConditions[]
  content: Record<string, UIDLStaticValue>
}

export interface UIDLStateDefinition {
  type: string
  defaultValue: string | number | boolean | unknown[] | object | (() => void)
  values?: UIDLStateValueDetails[]
}

export interface UIDLStateValueDetails {
  value: string | number | boolean
  pageOptions?: UIDLPageOptions // Used when the StateDefinition is used as the router
  seo?: UIDLComponentSEO
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
  content: string | number | boolean | unknown[] // unknown[] for data sources
}

export interface UIDLRawValue {
  type: 'raw'
  content: string
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
  semanticType?: string
  name?: string
  key?: string // internal usage
  dependency?: UIDLDependency
  style?: UIDLStyleDefinitions
  attrs?: Record<string, UIDLAttributeValue>
  events?: UIDLEventDefinitions
  abilities?: {
    link?: UIDLLinkNode
    // In the future more element abilities can be added here
  }
  referencedStyles?: UIDLReferencedStyles
  children?: UIDLNode[]
  selfClosing?: boolean
  ignore?: boolean
}

export type UIDLNode =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRawValue
  | UIDLRepeatNode
  | UIDLElementNode
  | UIDLConditionalNode
  | UIDLSlotNode
  | UIDLImportReference

export type UIDLAttributeValue = UIDLDynamicReference | UIDLStaticValue | UIDLImportReference

export type UIDLStyleValue = UIDLDynamicReference | UIDLStaticValue

export type UIDLStyleDefinitions = Record<string, UIDLStyleValue>

export type UIDLEventDefinitions = Record<string, UIDLEventHandlerStatement[]>

export interface UIDLImportReference {
  type: 'import'
  content: {
    id: string
  }
}

export interface UIDLURLLinkNode {
  type: 'url'
  content: {
    url: UIDLAttributeValue
    newTab: boolean
  }
}

export interface UIDLSectionLinkNode {
  type: 'section'
  content: { section: string }
}

export interface UIDLNavLinkNode {
  type: 'navlink'
  content: { routeName: string }
}
export interface UIDLMailLinkNode {
  type: 'mail'
  content: {
    mail: string
    subject?: string
    body?: string
  }
}
export interface UIDLPhoneLinkNode {
  type: 'phone'
  content: { phone: string }
}

export type UIDLLinkNode =
  | UIDLURLLinkNode
  | UIDLSectionLinkNode
  | UIDLNavLinkNode
  | UIDLMailLinkNode
  | UIDLPhoneLinkNode

export interface UIDLEventHandlerStatement {
  type: string
  modifies?: string
  newState?: string | number | boolean
  calls?: string
  args?: Array<string | number | boolean>
}

export type UIDLDependency = UIDLLocalDependency | UIDLExternalDependency

export interface UIDLPeerDependency {
  type: 'package'
  path: string
  version: string
}

export interface UIDLLocalDependency {
  type: 'local'
  path?: string
  meta?: {
    namedImport?: boolean
    originalName?: string
    importJustPath?: boolean
  }
}

export interface UIDLExternalDependency {
  type: 'library' | 'package'
  path: string
  version: string
  meta?: {
    namedImport?: boolean
    originalName?: string
    importJustPath?: boolean
    useAsReference?: boolean
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
  illegalClassNames?: string[]
  illegalPropNames?: string[]
}

export type UIDLReferencedStyles = Record<string, UIDLElementNodeReferenceStyles>

export type UIDLElementNodeReferenceStyles =
  | UIDLElementNodeProjectReferencedStyle
  | UIDLElementNodeInlineReferencedStyle

export type UIDLProjectReferencedStyleID = string
export interface UIDLElementNodeProjectReferencedStyle {
  id: string
  type: 'style-map'
  content: {
    mapType: 'project-referenced'
    conditions?: UIDLStyleConditions[]
    referenceId: UIDLProjectReferencedStyleID
  }
}
export interface UIDLElementNodeInlineReferencedStyle {
  id: string
  type: 'style-map'
  content: {
    mapType: 'inlined'
    conditions: UIDLStyleConditions[]
    styles: Record<string, UIDLStyleValue>
  }
}

export type UIDLStyleConditions = UIDLStyleMediaQueryScreenSizeCondition | UIDLStyleStateCondition

export interface UIDLStyleMediaQueryScreenSizeCondition {
  conditionType: 'screen-size'
  minHeight?: number
  maxHeight?: number
  minWidth?: number
  maxWidth?: number
}

export interface UIDLStyleStateCondition {
  conditionType: 'element-state'
  content: UIDLElementStyleStates
}

export type UIDLElementStyleStates = 'hover' | 'active' | 'focus' | 'disabled'

export type UIDLStyleSetConditions = UIDLStyleSetMediaCondition | UIDLStyleSetStateCondition

export interface UIDLStyleSetMediaCondition {
  type: 'screen-size'
  content: Record<string, UIDLStaticValue>
  meta: {
    maxWidth: number
    minWidth?: number
    maxHeight?: number
    minHeight?: number
  }
}

export interface UIDLStyleSetStateCondition {
  type: 'element-state'
  meta: {
    state: UIDLElementStyleStates
  }
  content: Record<string, UIDLStaticValue>
}
