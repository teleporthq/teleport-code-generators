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
  | 'teleport'
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

export interface UIDLAuthProvider {
  id: string
  name: string
  credentials: Record<string, string>
}

export interface UIDLAuthTableColumn {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey?: boolean
  defaultValue?: string
}

export interface UIDLAuthPageProtection {
  requiresAuth: boolean
  allowedRoles: string[]
  pageName: string
  route: string
  // Row-level ownership metadata for self-guarding details pages.
  // When set, the page's page-load SQL fetch enforces ownership
  // per-row (typically matching both the logged-in user_id and the
  // persistent anonymous-localStorage UUID, mirroring the
  // `Resolve User Or Guest Session` custom node), so the
  // framework-level middleware does not need to block unauthenticated
  // visitors at the route level — the SQL is the guard. The same
  // signal is consumed by the workflow emitter to neutralise the
  // redundant `isLoggedIn === true` page-load gate that would
  // otherwise redirect guest buyers away from the order they just
  // paid for under their anonymous UUID.
  rowOwnerColumn?: string
  rowOwnerTable?: string
  rowOwnerDataSourceId?: string
  rowOwnerDifferentiator?: string
}

export interface UIDLAuthFolderProtection {
  requiresAuth: boolean
  allowedRoles: string[]
  folderName: string
  parentId: string | null
  children: Record<string, 'page' | 'folder'>
}

export interface UIDLAuthPage {
  pageId: string
  pageName: string
  route: string
}

export interface UIDLCustomUserProperty {
  key: string
  label: string
  columnType: string
  attributeType: 'string' | 'number' | 'datetime' | 'boolean'
}

export interface UIDLAuthentication {
  enabled: boolean
  dataSourceId: string | null
  dataSourceType: DataSourceType | null
  passwordAuthEnabled: boolean
  providers: UIDLAuthProvider[]
  roles: string[]
  tables: Record<string, UIDLAuthTableColumn[]>
  pageProtection: Record<string, UIDLAuthPageProtection>
  folderProtection: Record<string, UIDLAuthFolderProtection>
  authPages: {
    signIn?: UIDLAuthPage
    signUp?: UIDLAuthPage
  }
  callbackBaseUrl: string
  envKeys: Record<string, string>
  customUserProperties: UIDLCustomUserProperty[]
}

export interface UIDLSortConfigEntry {
  field: string
  order: 'asc' | 'desc'
}

export interface UIDLDynamicFilterRef {
  referenceType: 'global' | 'globalState'
  id: string
  refPath: string[]
}

export interface UIDLFilterConfigEntry {
  source: string
  destination: unknown
  operand: string
  isDynamic?: boolean
  dynamicRef?: UIDLDynamicFilterRef
}

export interface UIDLGlobalStateDefinition {
  id: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  defaultValue: string | number | boolean | Record<string, unknown> | unknown[]
  name: string
  dataSourceBinding?: UIDLStateDataSourceBinding
  mappingFunction?: string
  sortConfig?: UIDLSortConfigEntry[]
  filterConfig?: UIDLFilterConfigEntry[]
  query?: string
}

export interface ProjectUIDL {
  name: string
  globals: UIDLGlobalProjectValues
  root: UIDLRootComponent
  components?: Record<string, ComponentUIDL>
  resources?: UIDLResources
  forms?: UIDLForms
  dataSources?: Record<string, UIDLDataSource>
  authentication?: UIDLAuthentication
  internationalization?: {
    main: {
      name: string
      locale: string
    }
    languages: Record<string, string>
    translations: Record<string, Record<string, UIDLElementNode | UIDLStaticValue>>
    ignoreBrowserLanguage?: boolean
  }
  workflows?: UIDLWorkflows
  globalStateDefinitions?: Record<string, UIDLGlobalStateDefinition>
  invoiceSettings?: UIDLInvoiceSettings
  ecommerceSettings?: UIDLEcommerceSettings
  aiAssistantChat?: UIDLAIAssistantChat
}

export interface UIDLAIAssistantChatAuthProtection {
  requiresAuth: boolean
  allowedRoles: string[]
}

export interface UIDLAIAssistantChat {
  enabled: boolean
  dataSourceId: string | null
  authProtection?: UIDLAIAssistantChatAuthProtection
  aiProvider: {
    provider: string
    model: string
    secretKeyReference: string | null
  } | null
  chatSettings: {
    chatName: string
    welcomeMessage: string
    unknownInformationMessage: string
    agentIconAssetId: string | null
    bubblePosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
    bubbleStyles: Record<string, string>
    bubbleClosedIconAssetId: string | null
    bubbleOpenedIconAssetId: string | null
    window: {
      windowStyles: Record<string, string>
      headerStyles: Record<string, string>
      messagesContainerStyles: Record<string, string>
      botMessageStyles: Record<string, string>
      userMessageStyles: Record<string, string>
      welcomeMessageStyles: Record<string, string>
      inputContainerStyles: Record<string, string>
      inputStyles: Record<string, string>
      sendButtonStyles: Record<string, string>
    }
    custom: {
      styles: string
      scripts: string
    }
  }
  ragConfig: {
    embeddingModel: string
    searchTopK: number
    conversationHistoryLimit: number
    rephrase: {
      temperature: number
      maxTokens: number
      systemMessage: string
    }
    answer: {
      temperature: number
      maxTokens: number
      streaming: boolean
      systemMessage: string
    }
  }
  tables: {
    settingsTable: string
    knowledgeSourcesTable: string
    documentsTable: string
    conversationsTable: string
    messagesTable: string
    topicsTable: string
  }
}

export interface UIDLWorkflows {
  workflows: Record<string, UIDLWorkflow>
  customNodes?: Record<string, UIDLCustomWorkflowNode>
}

export interface UIDLWorkflow {
  id: string
  name: string
  description?: string
  trigger: UIDLWorkflowTrigger
  webhookConfig?: UIDLWebhookConfig
  nodes: UIDLWorkflowNode[]
  edges: UIDLWorkflowEdge[]
  errorHandler?: UIDLWorkflowErrorHandler
  usedInNodes: Record<string, boolean | number>
}

export interface UIDLWebhookConfig {
  urlPath: string
  httpMethod: 'POST' | 'GET' | 'PUT' | 'DELETE'
  verifySignature: boolean
  signatureHeader?: string
  signatureSecret?: string
  signatureAlgorithm?: 'hmac-sha256' | 'hmac-sha1' | 'stripe-v1' | 'paypal-v1' | 'custom'
  expectedHeaders?: Array<{ key: string; value?: string }>
}

export interface UIDLWorkflowNode {
  id: string
  type: string
  label: string
  name?: string
  config: Record<string, unknown>
  executionEnv: 'client' | 'server' | 'universal'
  stepNumber: number
}

export interface UIDLWorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  data?: Record<string, unknown>
}

export interface UIDLWorkflowTrigger {
  nodeId: string
  type: string
  config: Record<string, unknown>
  scope: 'global' | 'page' | 'element'
}

export interface UIDLWorkflowErrorHandler {
  nodeId: string
  type: string
  config: Record<string, unknown>
  executionEnv: 'client' | 'server' | 'universal'
}

export interface UIDLCustomWorkflowNode {
  id: string
  name: string
  description?: string
  nodes: UIDLWorkflowNode[]
  edges: UIDLWorkflowEdge[]
  parameters: Array<{ key: string; defaultValue?: unknown }>
}

export interface WorkflowContextValue {
  type: 'workflowContext'
  nodeId: string
  path: string[]
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
  searchParams?: UIDLSearchParamsDefinition
  outputOptions?: UIDLComponentOutputOptions
  designLanguage?: {
    tokens?: UIDLDesignTokens
  }
  seo?: UIDLComponentSEO
}

export type UIDLSearchParamType = 'string' | 'number' | 'boolean'

export interface UIDLSearchParamDefinition {
  key: string
  type?: UIDLSearchParamType
  defaultValue?: string
  description?: string
}

export type UIDLSearchParamsDefinition = UIDLSearchParamDefinition[]

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
  dynamicRouteAttribute?: string
  pagination?: PagePaginationOptions
  initialPropsData?: UIDLInitialPropsData
  initialPathsData?: UIDLInitialPathsData
  pageId?: string
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

export interface UIDLStateDataSourceBinding {
  dataSourceId: string
  refPath: Array<string | number>
}

export interface UIDLStateUrlSearchParamBinding {
  key: string
}

export interface UIDLStateDefinition {
  type: string
  defaultValue: StateDefaultValueTypes
  id?: string
  dataSourceBinding?: UIDLStateDataSourceBinding
  urlSearchParamBinding?: UIDLStateUrlSearchParamBinding
  mappingFunction?: string
  sortConfig?: UIDLSortConfigEntry[]
  filterConfig?: UIDLFilterConfigEntry[]
  query?: string
}

export interface UIDLStateValueDetails {
  value: string | number | boolean
  pageId?: string
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

export interface UIDLDetailsPageInfo {
  dataSourceId: string
  dataSourceName: string
  dataSourceType: string
  tableName: string
  differentiatorColumn: string
  featureIdentifier: string
}

export interface UIDLPageOptions {
  componentName?: string
  navLink?: string
  fileName?: string
  fallback?: boolean
  dynamicRouteAttribute?: string
  pagination?: PagePaginationOptions
  initialPropsData?: UIDLInitialPropsData
  initialPathsData?: UIDLInitialPathsData
  detailsPageInfo?: UIDLDetailsPageInfo
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
  | 'ctx'
  | 'urlSearchParams'

export type UIDLDynamicReference =
  | UIDLReferenValues
  | UIDLGlobalReference
  | UIDLGlobalStateReference

interface UIDLReferenValues {
  type: 'dynamic'
  content: {
    referenceType: ReferenceType
    refPath?: string[]
    id: string
    fallback?: string | number | boolean
    /**
     * Optional JavaScript source string of the form
     * `function mapValue(value) { return String(...) }`. When present, the
     * resolved dynamic value is run through this function before being
     * rendered. Code generators and runtime renderers must wrap the base
     * expression in a sandboxed try/catch and fall back to the raw value
     * on error. See `packages/teleport-plugin-common/src/node-handlers/node-to-jsx/utils.ts`.
     */
    valueMapper?: string
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
    id: 'locale' | 'locales' | 'currentUser' | 'userIsLoggedIn' | 'ecommerce' | 'cart'
    refPath?: string[]
  }
}

export interface UIDLGlobalStateReference {
  type: 'dynamic'
  content: {
    referenceType: 'globalState'
    id: string
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
  dynamic?: UIDLDynamicReference
  fallback?: string
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
  // Initial value seeded into the generated search input's `useState`.
  // Static values are emitted verbatim; dynamic values are expected to
  // reference props / state / URL params and are emitted as expressions.
  searchDefaultValue?: UIDLStaticValue | UIDLExpressionValue
  sort?: UIDLStaticValue | UIDLExpressionValue
  sortDirection?: UIDLStaticValue | UIDLExpressionValue
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
    containsField?: string
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

export interface UIDLDynamicStyleBinding {
  referenceType: 'state' | 'ctx'
  stateKey: string
  contextName?: string
  defaultValue: string
  stateDefinitionId?: string
}

export interface UIDLElementRenderingConditions {
  reference: UIDLDynamicReference | UIDLExpressionValue
  condition: UIDLConditionalExpression
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
  dynamicStyleBindings?: Record<string, UIDLDynamicStyleBinding>
  renderingConditions?: UIDLElementRenderingConditions
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
    differentiatorValue?: UIDLDynamicReference | UIDLStaticValue | UIDLExpressionValue
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

/**
 * Type-aware state modifiers introduced in plan v14 to fix the broken
 * multi-step form output (`setCurrentStep(!currentStep)` on a number,
 * `setQuizAnswers('oily')` replacing an object). The bare literal forms
 * still work for `boolean` (`true` / `false` / `$toggle`), `string`, and
 * `number` state — but for numeric increments, object key patches, and
 * array appends the previous shape silently corrupted state. The four
 * new modifier variants below make the intent explicit and the codegen
 * can emit a functional setter (`setX(prev => ...)`) so the AI never has
 * to write arithmetic.
 *
 *   { type: '$increment'; delta?: number }
 *       Numeric state only. Emits `setX(prev => prev + (delta ?? 1))`.
 *   { type: '$decrement'; delta?: number }
 *       Numeric state only. Emits `setX(prev => prev - (delta ?? 1))`.
 *   { type: '$patch'; path: string; value: UIDLStateNewValuePrimitive }
 *       Object state only. Emits `setX(prev => ({ ...prev, [path]: value }))`.
 *   { type: '$append'; value: UIDLStateNewValuePrimitive }
 *       Array state only. Emits `setX(prev => [...prev, value])`.
 *
 * The codegen safety net (`createStateChangeStatement` in
 * teleport-plugin-common) is type-aware: `$toggle` / primitive replacements
 * against the wrong declared type now fail safe (skip the IIFE statement
 * + log a warn) instead of fail dirty (corrupt the React state).
 */
export type UIDLStateNewValuePrimitive =
  | string
  | number
  | boolean
  | UIDLDynamicReference
  | UIDLExpressionValue

export interface UIDLStateIncrementModifier {
  type: '$increment'
  /** Defaults to `1` when omitted. May be negative for decrement-by-step (use $decrement for clarity). */
  delta?: number
}

export interface UIDLStateDecrementModifier {
  type: '$decrement'
  delta?: number
}

export interface UIDLStatePatchModifier {
  type: '$patch'
  /** Object property name to patch. Single-level only; nested paths are not supported. */
  path: string
  value: UIDLStateNewValuePrimitive
}

export interface UIDLStateAppendModifier {
  type: '$append'
  value: UIDLStateNewValuePrimitive
}

export type UIDLStateNewValueModifier =
  | UIDLStateIncrementModifier
  | UIDLStateDecrementModifier
  | UIDLStatePatchModifier
  | UIDLStateAppendModifier

export type UIDLStateNewValue =
  | string
  | number
  | boolean
  | UIDLDynamicReference
  | UIDLExpressionValue
  | UIDLStateNewValueModifier

export interface UIDLStateModifierEvent {
  type: 'stateChange'
  modifies: string
  newState: UIDLStateNewValue
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

export interface UIDLEcommerceDeliveryConfig {
  deliveryPrice: number
  freeDeliveryEnabled: boolean
  freeDeliveryThreshold: number
  estimatedDeliveryDays: number | null
  allowDeliveryNotes: boolean
}

export interface UIDLEcommerceStockManagementConfig {
  allowBackorders: boolean
  lowStockThreshold: number
  lowStockAlerts: boolean
  outOfStockVisibility: 'visible' | 'hidden'
  maxQuantityPerProduct: number | null
  // Same shape as orderNotificationConfig — surfaced from the GUI so
  // the generated /api/ecommerce/low-stock-alert endpoint knows where
  // to send the alert and what subject/body templates to render. When
  // omitted (or when lowStockAlerts === false), the alert endpoint
  // is not emitted at all.
  lowStockAlertConfig?: UIDLEcommerceLowStockAlertConfig | null
}

// Mirrors UIDLEcommerceOrderNotificationConfig so the same email
// provider + template grammar applies to both flows. Kept separate
// (instead of a shared type) because the canonical token set differs:
// low-stock alerts resolve {{productsList}}, {{productsCount}},
// {{threshold}}, {{productName}}, {{sku}}, {{currentStock}},
// {{companyName}} — order notifications resolve order-shaped tokens.
export interface UIDLEcommerceLowStockAlertConfig {
  provider: string | null
  fromEmail: string
  fromName: string
  notificationEmails: string[]
  replyTo?: string
  subject?: string
  body?: string
}

export interface UIDLEcommerceOrderNotificationConfig {
  provider: string | null
  fromEmail: string
  fromName: string
  notificationEmails: string[]
  // Optional reply-to address surfaced as the email's Reply-To
  // header. Empty string means "no reply-to header" — recipients
  // reply to fromEmail.
  replyTo?: string
  // Subject + body templates with `{{token}}` placeholders. The
  // canonical tokens (orderNumber, customerName, customerEmail,
  // totalAmount, currency, paymentMethod, fulfillmentMethod,
  // itemsCount, orderDate, shippingAddress) are resolved by the
  // generated /api/ecommerce/order-notification handler from the
  // request payload. Unknown tokens render as empty string.
  subject?: string
  body?: string
}

export interface UIDLEcommercePaymentProvider {
  type: string
  name: string
}

export interface UIDLEcommerceSettings {
  cashOnDelivery: boolean
  deliveryEnabled: boolean
  storePickupEnabled: boolean
  guestCheckout: boolean
  stockManagement: boolean
  orderNotifications: boolean
  deliveryConfig: UIDLEcommerceDeliveryConfig | null
  stockManagementConfig: UIDLEcommerceStockManagementConfig | null
  orderNotificationConfig: UIDLEcommerceOrderNotificationConfig | null
  paymentProviders: UIDLEcommercePaymentProvider[]
  allowFavourites?: boolean
}

export interface UIDLInvoiceSettings {
  enabled: boolean
  autoGenerateOnPayment: boolean
  invoicePrefix: string
  nextInvoiceNumber: number
  defaultTaxRate: number
  taxIncludedInPrice: boolean
  showDiscount: boolean
  companyDetails: UIDLCompanyDetails
  template: { document: UIDLInvoiceLayoutNode }
  templateComponentId: string | null
  tables: { invoicesTable: string; invoiceItemsTable: string }
  dynamicFields: UIDLInvoiceDynamicField[]
  emailDelivery: UIDLInvoiceEmailDelivery
}

export interface UIDLCompanyDetails {
  companyName: string
  companyAddress: string
  companyCity: string
  companyState: string
  companyZip: string
  companyCountry: string
  companyVat: string
  companyRegNumber: string
  companyEmail: string
  companyPhone: string
  companyLogoAssetId: string | null
  companyWebsite: string
}

export interface UIDLInvoiceDynamicField {
  id: string
  label: string
  path: string
  type: 'string' | 'number' | 'date' | 'currency' | 'array'
  category: string
}

export interface UIDLInvoiceEmailDelivery {
  enabled: boolean
  provider: 'sendgrid' | 'resend' | 'mailgun' | 'postmark' | 'mailersend' | null
  fromEmail: string
  fromName: string
  subject: string
  body: string
  secretKeys: Record<string, string>
}

export interface UIDLInvoiceLayoutNode {
  id: string
  type:
    | 'document'
    | 'row'
    | 'column'
    | 'text'
    | 'image'
    | 'table'
    | 'divider'
    | 'spacer'
    | 'repeat'
    | 'conditional'
  label?: string
  enabled?: boolean
  styles?: Record<string, string | number>
  children?: UIDLInvoiceLayoutNode[]
  pageSettings?: {
    size: 'A4' | 'Letter' | 'Legal'
    orientation: 'portrait' | 'landscape'
    margins: { top: number; right: number; bottom: number; left: number }
  }
  defaultStyles?: {
    fontFamily: string
    fontSize: number
    color: string
    lineHeight: number
  }
  content?: UIDLInvoiceTextSpan[]
  source?: {
    type: 'static' | 'dynamic' | 'asset'
    value: string
    dynamicPropertyId?: string
  }
  alt?: string
  objectFit?: 'contain' | 'cover' | 'fill'
  columns?: UIDLInvoiceTableColumn[]
  showHeader?: boolean
  alternateRowBackground?: string
  dataSource?: string
  headerStyles?: Record<string, string | number>
  cellStyles?: Record<string, string | number>
  thickness?: number
  color?: string
  dashPattern?: number[]
  height?: number
  itemVariable?: string
  condition?: {
    propertyId: string
    operator: 'exists' | 'notExists' | 'equals' | 'notEquals' | 'greaterThan' | 'lessThan'
    value?: string | number
  }
}

export interface UIDLInvoiceTextSpan {
  id: string
  type: 'static' | 'dynamic'
  value: string
  dynamicPropertyId?: string
  format?: {
    dateFormat?: string
    currencyFormat?: boolean
    numberDecimals?: number
    thousandsSeparator?: string
    prefix?: string
    suffix?: string
  }
  styles?: Record<string, string | number>
}

export interface UIDLInvoiceTableColumn {
  id: string
  header: UIDLInvoiceTextSpan[]
  width?: string
  align?: 'left' | 'center' | 'right'
  cellContent: UIDLInvoiceTextSpan[]
  headerStyles?: Record<string, string | number>
  cellStyles?: Record<string, string | number>
}
