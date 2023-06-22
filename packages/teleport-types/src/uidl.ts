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

export interface ContextUIDLItem {
  name: string
  fileName?: string
}

export interface UIDLENVValue {
  type: 'env'
  content: string
}

export interface UIDLPropValue {
  type: 'dynamic'
  content: {
    referenceType: 'prop'
    id: string
  }
}

export interface UIDLResourceItem {
  name: string
  headers?: Record<string, UIDLStaticValue | UIDLENVValue>
  path: {
    baseUrl: UIDLStaticValue | UIDLENVValue
    route: UIDLStaticValue
  }
  method?: 'GET' | 'POST'
  body?: Record<string, UIDLStaticValue>
  params?: Record<string, UIDLStaticValue | UIDLPropValue>
  mappers?: string[]
  response?: {
    type: 'headers' | 'text' | 'json'
  }
}

/**
 * Common headers like Authorization and etc can be moved here.
 * Instead of re-repeating them in every call.
 * Eg: `Content-Type`
 */
export interface UIDLResources {
  resourceMappers?: Record<string, UIDLDependency>
  items?: Record<string, UIDLResourceItem>
}

export interface ProjectUIDL {
  name: string
  globals: UIDLGlobalProjectValues
  root: UIDLRootComponent
  components?: Record<string, ComponentUIDL>
  resources?: UIDLResources
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
  env?: Record<string, string>
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
export interface UIDLInitialPropsData {
  exposeAs: {
    name: string
    valuePath?: string[]
    itemValuePath?: string[]
  }
  resource: {
    id: string
    params?: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue>
  }
}

export interface UIDLInitialPathsData {
  exposeAs: {
    name: string
    valuePath?: string[]
    itemValuePath?: string[]
  }
  resource: {
    id: string
    params?: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue>
  }
}

export interface UIDLComponentOutputOptions {
  componentClassName?: string // needs to be a valid class name
  fileName?: string // needs to be a valid file name
  styleFileName?: string
  templateFileName?: string
  moduleName?: string
  folderPath?: string[]
  pagination?: PagePaginationOptions
  dynamicRouteAttribute?: string
  initialPropsData?: UIDLInitialPropsData
  initialPathsData?: UIDLInitialPathsData
}

export interface UIDLComponentSEO {
  title?: string | UIDLStaticValue | UIDLDynamicReference
  metaTags?: UIDLMetaTag[]
  assets?: UIDLGlobalAsset[]
}

export type UIDLMetaTag = Record<string, string | UIDLStaticValue | UIDLDynamicReference>

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

export interface PagePaginationOptions {
  attribute: string
  pageSize: number
  // We're using this property in order to get the total count of items for
  // a given entity. In order to get the total count, we might need to fetch at least
  // one item and get the actual count from the meta that is sent together with
  // the response
  totalCountPath: { type: 'headers' | 'body'; path: Array<string | number> }
}

export interface UIDLPageOptions {
  componentName?: string
  navLink?: string
  fileName?: string
  fallback?: boolean
  dynamicRouteAttribute?: string
  isIndex?: boolean
  pagination?: PagePaginationOptions
  initialPropsData?: UIDLInitialPropsData
  initialPathsData?: UIDLInitialPathsData
  propDefinitions?: Record<string, UIDLPropDefinition>
  stateDefinitions?: Record<string, UIDLStateDefinition>
}

export type ReferenceType = 'prop' | 'state' | 'local' | 'attr' | 'children' | 'token' | 'expr'

export interface UIDLDynamicReference {
  type: 'dynamic'
  content: {
    referenceType: ReferenceType
    path?: string[]
    expression?: string
    id: string
  }
}

export interface UIDLCMSReference {
  type: 'dynamic'
  content: {
    referenceType: 'cms'
    path: string[]
  }
}

export interface UIDLExpressionValue {
  type: 'expr'
  content: string
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
    fallback?: UIDLElementNode | UIDLStaticValue | UIDLDynamicReference | UIDLCMSReference
  }
}

export interface UIDLCMSListNode {
  type: 'cms-list'
  content: UIDLCMSListNodeContent
}

export interface UIDLCMSItemNode {
  type: 'cms-item'
  content: UIDLCMSItemNodeContent
}

/*
  A cms-list node can fetch data from the remote resouce
  or it can refer to a `prop` value for page list.
  It can have either remote resource or prop but not both.
  In the case of `prop` the data is fetched using `getStaticProps`
  or `getStaticPaths` at the moment in NextJS.
*/

export interface UIDLResourceLink {
  id: string
  params?: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue>
}

export interface UIDLCMSListNodeContent {
  name: string
  key: string // internal usage
  attrs?: Record<string, UIDLAttributeValue>
  nodes: {
    success: UIDLElementNode
    error?: UIDLElementNode
    loading?: UIDLElementNode
    empty?: UIDLElementNode
  }
  loopReferenceItem: string
  valuePath?: string[]
  itemValuePath?: string[]
  resource?: UIDLResourceLink
  initialData?: UIDLPropValue
}

export interface UIDLCMSItemNodeContent {
  name: string
  key: string // internal usage
  attrs?: Record<string, UIDLAttributeValue>
  loopReferenceItem: string
  nodes: {
    success: UIDLElementNode
    error?: UIDLElementNode
    loading?: UIDLElementNode
  }
  valuePath?: string[]
  itemValuePath?: string[]
  resource?: UIDLResourceLink
  initialData?: UIDLPropValue
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
  | UIDLCMSReference
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRawValue
  | UIDLRepeatNode
  | UIDLElementNode
  | UIDLConditionalNode
  | UIDLSlotNode
  | UIDLImportReference
  | UIDLCMSListNode
  | UIDLCMSItemNode

export interface UIDLComponentStyleReference {
  type: 'comp-style'
  content: string
}

export type UIDLAttributeValue =
  | UIDLCMSReference
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLImportReference
  | UIDLComponentStyleReference
  | UIDLRawValue

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

// for now only links will have this express
// type for dynamic content, but in the future
// all dynamic content will be handled this way
export type UIDLDynamicLinkNode = UIDLDynamicReference | UIDLCMSReference

export interface UIDLSectionLinkNode {
  type: 'section'
  content: { section: string }
}

export interface UIDLNavLinkNode {
  type: 'navlink'
  content: {
    routeName: string
    path?: string[]
    referenceType?: UIDLCMSReference['content']['referenceType']
  }
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
  | UIDLDynamicLinkNode

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
    importAlias?: string
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
    importAlias?: string
    needsWindowObject?: boolean
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
  /**
   * A string representing the style set's root name
   * e.g. for .container button > span, container would be the className
   *
   * For the sake of backwards compatibility, this is an optional parameter. It can be made
   * mandatory in the future, but all existing UIDL will need updating.
   */
  className?: string
  /**
   * Optional string containing all the subselectors of this style set.
   * e.g. for .container button > span, ' button > span' will be the subselector.
   *
   * Attention! Subselectors do not have a starting space by default.
   */
  subselectors?: string
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
