import { Modify } from './helper'

export type UIDLRootComponent = Modify<
  ComponentUIDL,
  {
    stateDefinitions: {
      route: UIDLRouteDefinitions
      [x: string]: UIDLStateDefinition
    }
  }
>

export interface UIDLRouteDefinitions {
  type: string
  defaultValue: string
  values: UIDLStateValueDetails[]
}
export interface ProjectUIDL {
  name: string
  globals: UIDLGlobalProjectValues
  root: UIDLRootComponent
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

export interface UIDLAssetBase {
  options?: {
    async?: boolean
    defer?: boolean
    target?: string
  }
}

export interface UIDLScriptInlineAsset extends UIDLAssetBase {
  type: 'script'
  content: string
}
export interface UIDLScriptExternalAsset extends UIDLAssetBase {
  type: 'script'
  path: string
}

export type UIDLScriptAsset = UIDLScriptExternalAsset | UIDLScriptInlineAsset

export interface UIDLStyleInlineAsset {
  type: 'style'
  content: string
  attrs?: Record<string, UIDLStaticValue>
}
export interface UIDLStyleExternalAsset {
  type: 'style'
  path: string
}

export type UIDLStyleAsset = UIDLStyleExternalAsset | UIDLStyleInlineAsset

export interface UIDLFontAsset {
  type: 'font'
  path: string
  attrs?: Record<string, UIDLStaticValue>
}
export interface UIDLCanonicalAsset {
  type: 'canonical'
  path: string
}
export interface UIDLIconAsset {
  type: 'icon'
  path: string
  options?: {
    iconType?: string
    iconSizes?: string
  }
}

export type UIDLGlobalAsset =
  | UIDLScriptAsset
  | UIDLStyleInlineAsset
  | UIDLStyleExternalAsset
  | UIDLFontAsset
  | UIDLCanonicalAsset
  | UIDLIconAsset

export interface ComponentUIDL {
  name: string
  node: UIDLElementNode
  styleSetDefinitions?: Record<string, UIDLStyleSetDefinition>
  propDefinitions?: Record<string, UIDLPropDefinition>
  importDefinitions?: Record<string, UIDLExternalDependency>
  peerDefinitions?: Record<string, UIDLPeerDependency>
  stateDefinitions?: Record<string, UIDLStateDefinition>
  outputOptions?: UIDLComponentOutputOptions
  designLanguage?: {
    tokens?: UIDLDesignTokens
  }
  seo?: UIDLComponentSEO
}

export type UIDLDesignTokens = Record<string, UIDLStaticValue>
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
  meta?: {
    target: 'style'
  }
}

export interface UIDLStateDefinition {
  type: string
  defaultValue: string | number | boolean | unknown[] | object | (() => void)
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
  fallback?: boolean
}

export type ReferenceType = 'prop' | 'state' | 'local' | 'attr' | 'children' | 'token'

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

export interface UIDLComponentStyleReference {
  type: 'comp-style'
  content: string
}

export type UIDLAttributeValue =
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLImportReference
  | UIDLComponentStyleReference

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

export interface UIDLPropCallEvent {
  type: 'propCall'
  calls: string
  args?: Array<string | number | boolean>
}

export interface UIDLStateModifierEvent {
  type: 'stateChange'
  modifies: string
  newState: string | number | boolean
}

export type UIDLEventHandlerStatement = UIDLPropCallEvent | UIDLStateModifierEvent

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
  | UIDLElementNodeCompReferencedStyle

export type UIDLProjectReferencedStyleID = string

export interface UIDLElementNodeCompReferencedStyle {
  type: 'style-map'
  content: {
    mapType: 'component-referenced'
    content: UIDLStaticValue | UIDLCompDynamicReference
  }
}
export interface UIDLElementNodeProjectReferencedStyle {
  type: 'style-map'
  content: {
    mapType: 'project-referenced'
    referenceId: UIDLProjectReferencedStyleID
  }
}
export interface UIDLElementNodeInlineReferencedStyle {
  type: 'style-map'
  content: {
    mapType: 'inlined'
    conditions: UIDLStyleConditions[]
    styles: Record<string, UIDLStyleValue>
  }
}

export type UIDLCompDynamicReference = {
  type: 'dynamic'
  content: {
    referenceType: 'prop' | 'comp'
    id: string
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

export type UIDLElementStyleStates =
  | 'hover'
  | 'active'
  | 'focus'
  | 'focus-within'
  | 'focus-visible'
  | 'disabled'
  | 'visited'
  | 'checked'
  | 'link'

export interface UIDLStyleSetDefinition {
  type:
    | 'reusable-project-style-map'
    | 'reusable-component-style-map'
    | 'reusable-component-style-override'
  conditions?: UIDLStyleSetConditions[]
  content: Record<string, UIDLStyleSheetContent>
}

export type UIDLStyleSheetContent = UIDLStaticValue | UIDLStyleSetTokenReference

export interface UIDLStyleSetTokenReference {
  type: 'dynamic'
  content: {
    referenceType: 'token'
    id: string
  }
}

export type UIDLStyleSetConditions = UIDLStyleSetMediaCondition | UIDLStyleSetStateCondition

export interface UIDLStyleSetMediaCondition {
  type: 'screen-size'
  content: Record<string, UIDLStaticValue | UIDLStyleSetTokenReference>
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
  content: Record<string, UIDLStaticValue | UIDLStyleSetTokenReference>
}
