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

/**
 * Caching for a data-source-backed list.
 *
 * Keyed by the WHOLE request shape (filters + sort + search + page), which the
 * generated `params` object already is, so a repeated combination costs no
 * database query. `versionScope` is what one invalidation clears: every entry
 * for that table, across every mapper, page, filter and page number.
 *
 * ⛔ `server: true` means one cached entry is served to EVERY visitor. It must
 * never be set for a list whose rows are scoped to the signed-in visitor. The
 * GUI decides that (page auth + user-ownership filter columns) and the code
 * generator independently re-checks that the emitted handler is a pure function
 * of the URL before it may share anything.
 */
export interface UIDLDataCacheConfig {
  enabled: boolean
  /** One user-facing duration, in seconds, applied to both layers. */
  ttlSeconds?: number
  /** Per-visitor cache in the browser. */
  client?: boolean
  /** In-process cache on the server, shared between visitors. */
  server?: boolean
  /** `Cache-Control: s-maxage`. Opt-in, and refusable at generation time. */
  cdnSMaxAge?: number
  cdnStaleWhileRevalidate?: number
  /** `<dataSourceId>:<tableName>` — the unit of invalidation. */
  versionScope?: string
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
  // The STATIC route prefix the page is served from: `/about` for a plain
  // page, `/orders` for a details page emitted as `/orders/[order_number]`.
  // The generated middleware treats a match on this value — exact or as a
  // `<route>/…` prefix — as "protected".
  route: string
  // Full route INCLUDING the dynamic segment (`/orders/[order_number]`).
  // Emitted only for details pages. `generateMiddlewareFile` uses it to know
  // exactly which requests a row-owned self-guarded page serves, so a sibling
  // listing page's protection on the shared static base (`/orders`) cannot
  // bounce a guest buyer away from `/orders/ORD-42`. Optional: UIDLs produced
  // before this field existed fall back to `route` + `rowOwnerDifferentiator`.
  routePattern?: string
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
  analytics?: UIDLAnalytics
}

export interface UIDLAnalytics {
  enabled: boolean
}

export interface UIDLAIAssistantChatAuthProtection {
  requiresAuth: boolean
  allowedRoles: string[]
}

/**
 * The languages the generated project has to serve the chat in.
 *
 * Absent on a single-language project — every locale-resolution branch in the
 * generated code is gated on this, so a project without it emits exactly the
 * code it emitted before localized chat copy existed.
 */
export interface UIDLAIAssistantChatLocalization {
  /** Locale whose copy lives in the flat `chatSettings` fields. */
  mainLocale: string
  /** Every locale, main first, in project order. */
  locales: string[]
}

/** One locale's fully resolved chat copy — neither field can be missing. */
export interface UIDLAIAssistantChatMessages {
  welcomeMessage: string
  unknownInformationMessage: string
}

export interface UIDLAIAssistantChat {
  enabled: boolean
  dataSourceId: string | null
  authProtection?: UIDLAIAssistantChatAuthProtection
  aiProvider: {
    provider: string
    model: string
    secretKeyReference: string | null
    /**
     * Project-secret name holding the OpenAI key used for query embeddings.
     * Always OpenAI regardless of `provider`: the knowledge base is indexed
     * with OpenAI `text-embedding-3-small`, so a query vector from any other
     * model cannot be compared against it. Optional so a UIDL produced before
     * this field existed still validates.
     */
    embeddingSecretKeyReference?: string | null
  } | null
  localization?: UIDLAIAssistantChatLocalization
  chatSettings: {
    chatName: string
    welcomeMessage: string
    unknownInformationMessage: string
    /**
     * The copy of EVERY locale, main locale included, already resolved: the GUI
     * applies the "falls back to the main language" rule before export, because
     * the generated project has no notion of an unset translation.
     *
     * Absent on a single-language project.
     */
    translations?: Record<string, UIDLAIAssistantChatMessages>
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
  // The auth requirement of this workflow's generated API route(s), computed by
  // the GUI mapper from the protection of the page(s) that trigger it plus a
  // scan of the workflow graph for user-owned writes. The code generators emit
  // a stateless (getToken-based) in-handler guard from it. Absent = no guard
  // (a purely public workflow, or auth is disabled). See UIDLWorkflowProtection.
  protection?: UIDLWorkflowProtection
}

/**
 * The auth policy the generated workflow API route enforces, baked at build
 * time so the runtime check is a single stateless JWT decode (no DB, no fetch).
 *
 * Two orthogonal concerns:
 *  - `requiresAuth` / `allowedRoles` — coarse "who may call this route", derived
 *    from the protection of the page(s) that trigger the workflow (most-
 *    restrictive union across them). `allowedRoles: []` with `requiresAuth`
 *    means "any authenticated user".
 *  - `userScoped` — row-level "this call may only act on the caller's own rows".
 *    Derived from the workflow graph (a resolve-current-user node feeding a
 *    user-owned column on a data write). The route overrides that column with
 *    the session user id, which closes the "act as another user" hole WITHOUT
 *    forcing a login — so a guest-capable public page (favourites/cart) keeps
 *    working while nobody can forge another user's id.
 */
export interface UIDLWorkflowProtection {
  requiresAuth: boolean
  allowedRoles: string[]
  userScoped?: UIDLWorkflowUserScope
  // Provenance, for debuggability and codegen decisions (never a security input):
  //  - 'page'           — exactly one triggering page supplied the requirement
  //  - 'multiple-pages' — union across several triggering pages
  //  - 'graph'          — no page requirement applied; userScoped came from the graph
  //  - 'default'        — fail-closed default for an unresolved data-mutating workflow
  derivedFrom: 'page' | 'multiple-pages' | 'graph' | 'default'
}

export interface UIDLWorkflowUserScope {
  // The user-owned column the write targets (e.g. `user_id`, `follower_id`),
  // representative for logging/debug when several are bound.
  ownerColumn: string
  // Exact context locations the route overwrites with the authenticated session
  // user id before executing the write, so a user-owned column can never be
  // forged. Each is `context[nodeId]` drilled down `path` (e.g. ['userId'] or
  // ['user','id']) — the same reference the write's column mapping/filter reads.
  bindings: UIDLWorkflowUserScopeBinding[]
}

export interface UIDLWorkflowUserScopeBinding {
  nodeId: string
  path: string[]
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
  scope: 'global' | 'page' | 'element' | 'component'
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
  // A custom node's server segment is emitted as its own API route, shared by
  // every workflow that invokes it. Its policy is the most-restrictive union of
  // the protection of those workflows, plus identity binding from the custom
  // node's own graph. Same shape/enforcement as UIDLWorkflow.protection.
  protection?: UIDLWorkflowProtection
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
  /**
   * A prop reference whose runtime value, when truthy, replaces the canonical
   * href (and the mirrored og:url). Used by details pages whose entity rows
   * carry their own canonical URL (e.g. a blog post's `canonical_url` column);
   * `path` remains the fallback for rows without one.
   */
  dynamicOverride?: UIDLDynamicReference
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
  /*
    Entity-level redirect support for details pages. When set, the generated
    getStaticProps/getServerSideProps returns a redirect whenever the fetched
    row's `destinationField` (a field on the transformed entity, e.g.
    `redirectUrl`) holds a non-empty value. `typeField` names the field holding
    '301' | '302'; anything other than '302' redirects with statusCode 301.
  */
  redirect?: {
    destinationField: string
    typeField?: string
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
  detailsPageInfo?: UIDLDetailsPageInfo
  pageId?: string
}

export interface UIDLComponentSEO {
  title?: string | UIDLStaticValue | UIDLDynamicReference
  metaTags?: UIDLMetaTag[]
  assets?: UIDLGlobalAsset[]
  /**
   * JSON-LD (`application/ld+json`) structured-data blocks rendered into the
   * page <head>. Each entry is either a pre-serialized JSON string (fully
   * static, emitted verbatim) or a node tree whose leaves may be dynamic
   * prop/locale references or small computed expressions resolved at render
   * time. See `teleport-plugin-jsx-head-config/src/structured-data-ast.ts`.
   */
  structuredData?: UIDLStructuredDataEntry[]
}

export type UIDLMetaTag = Record<string, string | UIDLStaticValue | UIDLDynamicReference>

export type UIDLStructuredDataEntry = string | UIDLStructuredDataObject

export interface UIDLStructuredDataObject {
  [key: string]: UIDLStructuredDataNode
}

export type UIDLStructuredDataNode =
  | string
  | number
  | boolean
  | null
  | UIDLStaticValue
  | UIDLDynamicReference
  | UIDLStructuredDataComputed
  | UIDLStructuredDataObject
  | UIDLStructuredDataNode[]

/**
 * A small set of runtime-computed JSON-LD leaves the head-config plugin knows
 * how to emit. `refPath` is the prop path to the entity record (e.g.
 * `['ecommerceProduct']`), `column` the field beneath it the computation uses.
 * - `availability`: `<entity>.<column> === 0 ? OutOfStock : InStock`
 * - `itemCondition`: maps `<entity>.<column>` (new/refurbished/used) to the
 *   matching schema.org condition URL, defaulting to NewCondition.
 * - `concatUrl`: `` `${urlPrefix}${<entity>.<column>}` `` (e.g. product URL).
 */
export interface UIDLStructuredDataComputed {
  type: 'computed'
  kind: 'availability' | 'itemCondition' | 'concatUrl'
  refPath: string[]
  column: string
  urlPrefix?: string
}

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
  lastmod?: string
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
  attrs?: Record<string, UIDLAttributeValue>
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
  // URL query-param key the search input is two-way bound to (e.g.
  // `'searchKeyword'`). When set, the code generator seeds the query from
  // `window.location.search`, keeps it in sync on browser navigation
  // (read-back), and pushes the debounced value back onto the URL
  // (write-back) — see `URLSearchParamSync` in `teleport-plugin-common`.
  searchUrlParamKey?: string
  sort?: UIDLStaticValue | UIDLExpressionValue
  sortDirection?: UIDLStaticValue | UIDLExpressionValue
  /**
   * Whether the rows this repeater draws are still being fetched.
   *
   * A repeater whose `source` is a data source is wrapped in a `DataProvider`,
   * which owns that question and answers it through `renderLoading`. A repeater
   * fed by a plain STATE has no provider at all, so nothing could tell it that a
   * fetch was in flight and its `nodes.loading` branch was unreachable in the
   * generated code. This is that signal: when it resolves to `true` (or the
   * string `'true'`, which is what a generated string state holds), the `loading`
   * branch renders INSTEAD of the repeater.
   *
   * ⛔ Never set this on a data-source-backed repeater: its loading branch is
   * hoisted onto the `DataProvider` (`hoistLoadingFromRepeaterToDataSource`), so
   * the two would render the same branch twice.
   */
  isLoading?: UIDLStaticValue | UIDLExpressionValue
  /** Per-mapper caching. Overrides the data-source-level default below. */
  cache?: UIDLDataCacheConfig
  /**
   * Which pagination controls the generated list draws.
   *
   * `'buttons'` (the default when absent) wires only the Previous/Next pair.
   * `'numbered'` additionally wires First/Last and repeats the authored
   * page-number template button once per visible page.
   *
   * Ignored when `infiniteScroll` is set — an accumulating list has no pages
   * to jump between.
   */
  paginationMode?: 'buttons' | 'numbered'
  /**
   * Append rows to the list instead of replacing them page by page.
   *
   * Suppresses every pagination control except an authored Load More button,
   * and — because a partially loaded list must not be served from a client
   * cache peek — disables `cache.client` for this repeater.
   */
  infiniteScroll?: boolean
  /**
   * With `infiniteScroll`: append on a click of the authored Load More button
   * rather than automatically when the visitor scrolls to the end of the list.
   */
  infiniteScrollLoadMore?: boolean
  /**
   * URL query-param key the current page is two-way bound to (e.g. `'page'`),
   * the pagination counterpart of `searchUrlParamKey`. Page 1 is written as
   * the ABSENCE of the key, so an unpaginated visit keeps a clean URL.
   *
   * Ignored when `infiniteScroll` is set.
   */
  pageUrlParamKey?: string
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

export interface UIDLConditionExpressionEntry {
  operation: string
  operand?: string | boolean | number | UIDLDynamicReference | UIDLExpressionValue
  containsField?: string
  // Left side of THIS entry. Absent = inherit the expression's top-level reference.
  reference?: UIDLDynamicReference | UIDLExpressionValue
}

// A parenthesized sub-chain: its conditions combine under its own
// matchingCriteria and the result joins the parent chain as ONE entry.
// Distinguished from a leaf entry by the presence of `conditions`.
export interface UIDLConditionExpressionGroup {
  conditions: Array<UIDLConditionExpressionEntry | UIDLConditionExpressionGroup>
  matchingCriteria?: string
}

export interface UIDLConditionalExpression {
  conditions: Array<UIDLConditionExpressionEntry | UIDLConditionExpressionGroup>
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

// A node in the nested category tree baked into the generated store. The GUI
// stores a flat adjacency list (`doc.ecommerceCategories`); it is baked as a
// nested tree so the storefront category-filter array mapper iterates roots and
// a nested mapper binds `item.children`. Exposed at runtime as
// `useEcommerce().ecommerceCategories` (the `E-Commerce Categories` global).
/** Per-language override for a category's `name`/`description`, keyed by language short (e.g. `fr`). */
export interface UIDLEcommerceCategoryTranslation {
  name?: string
  description?: string
}

export interface UIDLEcommerceCategory {
  id: string
  name: string
  slug: string
  parentId: string | null
  order: number
  image?: string | null
  /** Resolved public image URL (asset ids resolved at bake time). */
  imageUrl?: string | null
  icon?: string | null
  description?: string | null
  /** Per-language overrides for `name`/`description`; missing fields fall back to the main-language values above. */
  translations?: Record<string, UIDLEcommerceCategoryTranslation>
  children: UIDLEcommerceCategory[]
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
  // Discount vouchers. Gates the checkout voucher input and the discount row at
  // runtime, so a storefront exported before the feature (where this is absent)
  // reads as "off" and behaves exactly as it did.
  vouchersEnabled?: boolean
  // Nested category tree for the storefront category filter (see above).
  categories?: UIDLEcommerceCategory[]
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
