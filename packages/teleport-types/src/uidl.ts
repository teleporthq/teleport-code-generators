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
    refPath?: string[]
    id: string
  }
}

export interface UIDLStateValue {
  type: 'dynamic'
  content: {
    referenceType: 'state'
    refPath?: string[]
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
  body?: Record<string, UIDLStaticValue | UIDLExpressionValue>
  params?: Record<string, UIDLStaticValue | UIDLPropValue | UIDLStateValue | UIDLExpressionValue>
  mappers?: string[]
  response?: {
    type: 'headers' | 'text' | 'json' | 'none'
  }
}

/**
 * Common headers like Authorization and etc can be moved here.
 * Instead of re-repeating them in every call.
 * Eg: `Content-Type`
 */

export interface UIDLResourceMapper {
  params: string[]
  dependency: UIDLDependency
}

export interface UIDLResources {
  resourceMappers?: Record<string, UIDLResourceMapper>
  items?: Record<string, UIDLResourceItem>
  cache?: {
    revalidate?: number
    webhook?: {
      name: string
      dependency: UIDLDependency
    }
  }
}

export type DataSourceType =
  | 'rest-api'
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'amazon-redshift'
  | 'mongodb'
  | 'cockroachdb'
  | 'tidb'
  | 'redis'
  | 'firestore'
  | 'clickhouse'
  | 'airtable'
  | 'supabase'
  | 'turso'
  | 'javascript'
  | 'google-sheets'
  | 'csv-file'
  | 'static-collection'

export interface UIDLDataSource {
  id: string
  name: string
  type: DataSourceType
  config: Record<string, unknown>
}

export interface UIDLDataSourceResourceDefinition {
  type: 'external-data-source'
  dataSourceId: string
  tableName: string
  dataSourceType: DataSourceType
}

export interface ProjectUIDL {
  name: string
  globals: UIDLGlobalProjectValues
  root: UIDLRootComponent
  components?: Record<string, ComponentUIDL>
  resources?: UIDLResources
  forms?: UIDLForms
  dataSources?: Record<string, UIDLDataSource>
  internationalization?: {
    main: {
      name: string
      locale: string
    }
    languages: Record<string, string>
    translations: Record<string, Record<string, UIDLElementNode | UIDLStaticValue>>
    ignoreBrowserLanguage?: boolean
  }
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

export interface UIDLLocalFontAsset {
  type: 'local-font'
  path: string
  properties: Record<string, UIDLStaticValue>
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
  | UIDLLocalFontAsset

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
    valuePath: string[]
  }
  resource:
    | {
        id: string
        params?: Record<string, UIDLStaticValue | UIDLExpressionValue>
      }
    | {
        name: string
        dependency: UIDLExternalDependency
        params?: Record<string, UIDLStaticValue | UIDLExpressionValue>
      }
  /*
    We allow the configuration of cache strategy globally for the whole project under
    uidl.resources.cache
    But in the case of using a using a webhook. The cache for routes like
    /blog-post/page/pageNumber can't be handled. Since the page number of the
    entity changed can't be known in advance.

    This allows to set custom cache revalidation for those pages which overrides the cache that
    is configured globally at uidl.resources.cache.revalidate
  */
  cache?: {
    revalidate: number
  }
}

export interface UIDLInitialPathsData {
  exposeAs: {
    name: string
    valuePath?: string[]
    itemValuePath?: string[]
  }
  resource:
    | {
        id: string
        params?: Record<string, UIDLStaticValue | UIDLExpressionValue>
      }
    | {
        name: string
        dependency: UIDLExternalDependency
        params?: Record<string, UIDLStaticValue | UIDLExpressionValue>
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
  initialPropsData?: UIDLInitialPropsData
  initialPathsData?: UIDLInitialPathsData
}

export interface UIDLComponentSEO {
  title?: string | UIDLStaticValue | UIDLDynamicReference
  metaTags?: UIDLMetaTag[]
  assets?: UIDLGlobalAsset[]
}

export type UIDLMetaTag = Record<string, string | UIDLStaticValue | UIDLDynamicReference>

export type PropDefaultValueTypes =
  | string
  | number
  | boolean
  | unknown[]
  | object
  | (() => void)
  | UIDLElementNode

export type StateDefaultValueTypes = string | number | boolean | unknown[] | object | (() => void)

export interface UIDLPropDefinition {
  type: string
  defaultValue?: PropDefaultValueTypes
  isRequired?: boolean
  id?: string
  meta?: {
    target: 'style'
  }
}

export interface UIDLStateDefinition {
  type: string
  defaultValue: StateDefaultValueTypes
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
  lastmod?: string
  pagination?: PagePaginationOptions
  initialPropsData?: UIDLInitialPropsData
  initialPathsData?: UIDLInitialPathsData
  propDefinitions?: Record<string, UIDLPropDefinition>
  stateDefinitions?: Record<string, UIDLStateDefinition>
}

export type ReferenceType =
  | 'prop'
  | 'state'
  | 'local'
  | 'attr'
  | 'children'
  | 'token'
  | 'expr'
  | 'locale'

export type UIDLDynamicReference = UIDLReferenValues | UIDLGlobalReference

interface UIDLReferenValues {
  type: 'dynamic'
  content: {
    referenceType: ReferenceType
    refPath?: string[]
    id: string
    fallback?: string | number | boolean
  }
}

/*
  The id value refers to the global values that needs to be represented.
  These values are fixed and each framework can make its own decision of how to import and pass these values.
  Eg: link can come from router, locale can come from i18 etc
 */
export interface UIDLGlobalReference {
  type: 'dynamic'
  content: {
    referenceType: 'global'
    id: 'locale' | 'locales'
    refPath?: string[]
  }
}

export interface UIDLExpressionValue {
  type: 'expr'
  content: string
}

export interface UIDLStaticValue {
  type: 'static'
  content: string | number | boolean | Record<string, unknown> | unknown[] // unknown[] for data sources
}

export interface UIDLRawValue {
  type: 'raw'
  content: string
}

export interface UIDLInjectValue {
  type: 'inject'
  content: string
  dependency?: UIDLExternalDependency
}

export interface UIDLSlotNode {
  type: 'slot'
  content: {
    name?: string
    fallback?: UIDLElementNode | UIDLStaticValue | UIDLDynamicReference | UIDLExpressionValue
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

export interface UIDLObjectValue {
  type: 'object'
  content: unknown
}

export interface UIDLCMSMixedTypeNode {
  type: 'cms-mixed-type'
  content: {
    elementType: string
    name: string
    key: string
    dependency?: UIDLDependency
    attrs: Record<string, UIDLAttributeValue>
    renderPropIdentifier: string
    nodes: {
      fallback?: UIDLElementNode
      error?: UIDLElementNode
    }
    mappings?: Record<string, UIDLElementNode>
  }
}

export interface UIDLCMSListRepeaterNode {
  type: 'cms-list-repeater'
  content: UIDLCMSListRepeaterNodeContent
}

/*
  A cms-list node can fetch data from the remote resouce
  or it can refer to a `prop` value for page list.
  It can have either remote resource or prop but not both.
*/

export type UIDLResourceLink = UIDLLocalResource | UIDLExternalResource

export interface UIDLLocalResource {
  id: string
  params?: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue | UIDLStateValue>
}

export interface UIDLExternalResource {
  name: string
  dependency: UIDLExternalDependency
  params?: Record<string, UIDLStaticValue | UIDLPropValue | UIDLExpressionValue | UIDLStateValue>
}

export interface UIDLCMSListNodeContent {
  elementType: string
  name?: string
  key: string // internal usage
  attrs?: Record<string, UIDLAttributeValue>
  dependency?: UIDLDependency
  router?: UIDLDependency
  nodes: {
    success: UIDLElementNode
    error?: UIDLElementNode
    loading?: UIDLElementNode
  }
  renderPropIdentifier: string
  valuePath: string[]
  paginationQueryParam?: UIDLStaticValue | UIDLPropValue | UIDLExpressionValue
  resource?: UIDLResourceLink
  initialData?: UIDLPropValue
}

export interface UIDLCMSItemNodeContent {
  elementType: string
  name: string
  key: string // internal usage
  attrs?: Record<string, UIDLAttributeValue>
  renderPropIdentifier: string
  router?: UIDLDependency
  dependency?: UIDLDependency
  nodes: {
    success: UIDLElementNode
    error?: UIDLElementNode
    loading?: UIDLElementNode
  }
  valuePath: string[]
  resource?: UIDLResourceLink
  initialData?: UIDLPropValue
  entityKeyProperty?: string
}

export interface UIDLCMSListRepeaterNodeContent {
  elementType: string
  name: string
  key: string // internal usage
  dependency?: UIDLDependency
  nodes: {
    list: UIDLElementNode
    empty?: UIDLElementNode
    loading?: UIDLElementNode
  }
  renderPropIdentifier: string
  source?: string
  paginated?: boolean
  perPage?: number
  searchEnabled?: boolean
  searchDebounce?: number
}

export interface UIDLDataSourceItemNode {
  type: 'data-source-item'
  content: UIDLDataSourceItemNodeContent
}

export interface UIDLDataSourceListNode {
  type: 'data-source-list'
  content: UIDLDataSourceListNodeContent
}

export interface UIDLDataSourceItemNodeContent {
  elementType: string
  name?: string
  key?: string
  attrs?: Record<string, UIDLAttributeValue>
  dependency?: UIDLDependency
  resourceDefinition: UIDLDataSourceResourceDefinition
  renderPropIdentifier: string
  nodes?: {
    success: UIDLElementNode
    error?: UIDLElementNode
    loading?: UIDLElementNode
  }
  children?: UIDLNode[]
  valuePath?: string[]
  resource?: UIDLResourceLink
  initialData?: UIDLPropValue
}

export interface UIDLDataSourceListNodeContent {
  elementType: string
  name?: string
  key?: string
  attrs?: Record<string, UIDLAttributeValue>
  dependency?: UIDLDependency
  resourceDefinition: UIDLDataSourceResourceDefinition
  renderPropIdentifier: string
  nodes?: {
    success: UIDLElementNode
    error?: UIDLElementNode
    loading?: UIDLElementNode
  }
  children?: UIDLNode[]
  valuePath?: string[]
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
  dataSource:
    | UIDLExpressionValue
    | UIDLDynamicReference
    | UIDLStaticValue
    | UIDLImportReference
    | UIDLComponentStyleReference
    | UIDLRawValue
  meta?: UIDLRepeatMeta
}

export interface UIDLRepeatMeta {
  useIndex?: boolean
  iteratorName?: string
  dataSourceIdentifier?: string
  iteratorKey?: string
}

export interface UIDLDynamicCondition {
  reference: UIDLDynamicReference
  importDefinitions?: Record<string, UIDLExternalDependency>
  value?: string | number | boolean
  expression?: UIDLConditionalExpression
}

export interface UIDLConditionalNode {
  type: 'conditional'
  content: {
    node: UIDLNode
    reference: UIDLDynamicReference | UIDLExpressionValue
    importDefinitions?: Record<string, UIDLExternalDependency>
    value?: string | number | boolean
    condition?: UIDLConditionalExpression
  }
}

export interface UIDLConditionalExpression {
  conditions: Array<{
    operation: string
    operand?: string | boolean | number | UIDLDynamicReference | UIDLExpressionValue
  }>
  // In the code generation phase, we are only supporting 'all' or '||'
  // Maybe the type checking for this can be improved.
  matchingCriteria?: string
}

export interface UIDLElementNode {
  type: 'element'
  content: UIDLElement
}

export interface UIDLDateTimeNode {
  type: 'date-time-node'
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
}

export type UIDLNode =
  | UIDLExpressionValue
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLRawValue
  | UIDLInjectValue
  | UIDLRepeatNode
  | UIDLElementNode
  | UIDLConditionalNode
  | UIDLSlotNode
  | UIDLImportReference
  | UIDLCMSListNode
  | UIDLCMSItemNode
  | UIDLDateTimeNode
  | UIDLCMSListRepeaterNode
  | UIDLCMSMixedTypeNode
  | UIDLDataSourceItemNode
  | UIDLDataSourceListNode

export interface UIDLComponentStyleReference {
  type: 'comp-style'
  content: string
}

export type UIDLAttributeValue =
  | UIDLExpressionValue
  | UIDLDynamicReference
  | UIDLStaticValue
  | UIDLImportReference
  | UIDLComponentStyleReference
  | UIDLRawValue
  | UIDLElementNode
  | UIDLObjectValue

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
    url:
      | UIDLExpressionValue
      | UIDLDynamicReference
      | UIDLStaticValue
      | UIDLImportReference
      | UIDLComponentStyleReference
      | UIDLRawValue
    newTab: boolean
  }
}

// for now only links will have this express
// type for dynamic content, but in the future
// all dynamic content will be handled this way
export type UIDLDynamicLinkNode = UIDLDynamicReference

export interface UIDLSectionLinkNode {
  type: 'section'
  content: { section: UIDLStaticValue | UIDLExpressionValue }
}

export interface UIDLNavLinkNode {
  type: 'navlink'
  content: {
    routeName:
      | UIDLExpressionValue
      | UIDLDynamicReference
      | UIDLStaticValue
      | UIDLImportReference
      | UIDLComponentStyleReference
      | UIDLRawValue
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
  includeEventObject?: boolean
}

export interface UIDLStateModifierEvent {
  type: 'stateChange'
  modifies: string
  newState: string | number | boolean | UIDLDynamicReference | UIDLExpressionValue
  includeEventObject?: boolean
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
    condition?: UIDLDynamicCondition
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
    refPath?: string[]
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

export interface UIDLForms {
  // Forms indexed by form ID for easy lookup
  items: Record<string, UIDLFormDefinition>

  // Optional: Global form configuration that applies to all forms
  globalConfig?: {
    // Default captcha provider if used across multiple forms
    captchaProvider?: 'recaptcha' | 'hcaptcha' | 'turnstile'
    // Default email service configuration reference
    emailServiceRef?: string
    // Default captcha public key (can be overridden per form)
    defaultCaptchaPublicKey?: UIDLStaticValue | UIDLENVValue
  }

  // Server URL for form submissions (overrides NEXT_PUBLIC_FORMS_API_URL)
  formsServerUrl?: UIDLStaticValue | UIDLENVValue
}

export interface UIDLFormDefinition {
  // Core identification
  id: UIDLStaticValue
  name: UIDLStaticValue
  formNodeId: UIDLStaticValue // Links to the actual form element in the component tree

  // Context - which page/component contains this form
  context?: {
    type: 'page' | 'component'
    id: UIDLStaticValue
  }

  // Form fields structure
  fields: Record<string, UIDLFormField>

  // Behavior configurations
  behaviors: {
    onSuccess: UIDLFormBehavior
    onError: UIDLFormBehavior
    onLimit?: UIDLFormBehavior
  }

  // Email notifications
  notifications?: {
    sendToSubscriber: UIDLStaticValue // boolean
    sendToEmails: UIDLStaticValue[] // string[]
  }

  // Security & validation
  security?: {
    captchaPublicKey?: UIDLStaticValue | UIDLENVValue
    honeypotField?: UIDLStaticValue
  }

  // Limits & constraints
  constraints?: {
    expirationDate?: UIDLStaticValue // ISO date string
    submissionsLimit?: UIDLStaticValue // number
  }

  // Alert messages for different states
  messages?: {
    success?: UIDLStaticValue
    error?: UIDLStaticValue
    limit?: UIDLStaticValue
  }

  // Metadata
  meta?: {
    createdAt: UIDLStaticValue
    updatedAt: UIDLStaticValue
  }
}

export interface UIDLFormField {
  id: UIDLStaticValue
  name: UIDLStaticValue
  nodeId: UIDLStaticValue // Links to the input element node
  type: 'textinput' | 'textarea' | 'select' | 'checkbox' | 'radiobutton' | 'button'
  required?: UIDLStaticValue // boolean

  // Future extensibility for validation rules
  validation?: {
    pattern?: UIDLStaticValue
    minLength?: UIDLStaticValue
    maxLength?: UIDLStaticValue
    min?: UIDLStaticValue
    max?: UIDLStaticValue
    customValidation?: UIDLExpressionValue
  }
}

export type UIDLFormBehaviorAction =
  | 'message'
  | 'redirect-page'
  | 'redirect-url'
  | 'clear-form'
  | 'clear-form-and-alert'

export interface UIDLFormBehavior {
  action: UIDLFormBehaviorAction

  // Action-specific details
  details?: {
    // For redirect-page: reference to page state value
    pageId?: UIDLStaticValue

    // For redirect-url: external URL
    url?: UIDLStaticValue

    // For message: can be either a static message or a component reference
    message?:
      | UIDLStaticValue
      | {
          type: 'component-ref'
          componentId: UIDLStaticValue
        }
  }
}
