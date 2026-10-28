import type {
  DataReadExposure,
  ProjectDataExposure,
  ProjectUIDL,
  UIDLAuthentication,
} from '@teleporthq/teleport-types'
import {
  PageAccessPolicy,
  ProtectedRouteTable,
  buildProtectedRouteTable,
  resolveRouteAccessPolicy,
  selfGuardedOwnerColumnAt,
} from './page-access'
import { camelCaseToDashCase, removeIllegalCharacters } from './string-utils'
import { SUBSCRIPTION_ENTITLED_STATUSES, SUBSCRIPTION_ENTITLEMENT_SQL } from './subscription-access'

/**
 * Which tables a BROWSER may read through the generated read routes
 * (`/api/<source>-<table>-<id>` and its count twin), decided at export time
 * from the pages that bind them — not from a list of dangerous names.
 *
 * Every table a page binds gets a read route, and the route is a URL anyone can
 * call. A table some page EVERY visitor may open binds (a product list, the
 * blog, the bookable items, a merchant's own table shown on a public page) is
 * the site's public content: anyone reads it, as before. A table only pages
 * behind a sign-in bind is read only with a session one of those pages admits
 * (any session, or one of their roles). A table no page binds is read only by
 * the app's own server code. `TableAccess.PROTECTED_TABLES` stays a second net
 * on top: an admin page binding the orders does not make them public.
 *
 * "Binds" is any way a page (or a component it renders, or the layout every
 * page shares) names a table: a data provider, a details page's entity, a
 * resource its static props read, a state seeded from a table, an app-wide
 * global state.
 *
 * The rows one browser read gets are bounded too: `BROWSER_READ_DEFAULT_LIMIT`
 * when the request names no count — raised to the maximum for a table some list
 * binds whole (no limit of its own) — and never more than
 * `BROWSER_READ_MAX_LIMIT`, or the largest count a binding of the table asks.
 */

export const BROWSER_READ_DEFAULT_LIMIT = 100
export const BROWSER_READ_MAX_LIMIT = 500

/**
 * The longest one database query of a generated read path may run, in
 * milliseconds (A5-L5). Enforced on the client (`pg`'s \`query_timeout\`): a
 * server-side statement_timeout is a startup parameter pooled connection
 * strings refuse, or a session SET a pooler hands to the next client.
 */
export const READ_QUERY_TIMEOUT_MS = 10000

/** What a table no page binds gets: the app's own server code only. */
export const CLOSED_READ_EXPOSURE: DataReadExposure = Object.freeze({
  public: false,
  anySession: false,
  roles: [],
  defaultLimit: BROWSER_READ_DEFAULT_LIMIT,
  maxLimit: BROWSER_READ_MAX_LIMIT,
}) as DataReadExposure

/** The data sources whose reads have no table: their exposure is the source's. */
const SOURCES_WITHOUT_TABLES = new Set([
  'rest-api',
  'javascript',
  'csv-file',
  'google-sheets',
  'redis',
])

export const isSourceWithoutTables = (dataSourceType: string): boolean =>
  SOURCES_WITHOUT_TABLES.has(String(dataSourceType || ''))

/**
 * The ids of `uidl`'s TeleportHQ data sources: the managed database the data
 * API (`/api/data/<id>/…`) reads, whatever id its path names.
 */
export const managedDataSourceIds = (uidl: {
  dataSources?: Record<string, { id?: string; type?: string } | undefined>
}): string[] => {
  const ids = new Set<string>()
  Object.entries(uidl.dataSources || {}).forEach(([key, source]) => {
    if (source && source.type === 'teleport') {
      ids.add(key)
      if (typeof source.id === 'string' && source.id) {
        ids.add(source.id)
      }
    }
  })
  return Array.from(ids).sort()
}

/** `public."Users"` → `users`. */
export const bareTableName = (tableName: string): string => {
  const parts = String(tableName || '')
    .trim()
    .toLowerCase()
    .split('.')
  return parts[parts.length - 1].replace(/["'`]/g, '')
}

interface Binding {
  dataSourceId: string | null
  table: string | null
  /** A list that names no row count of its own: it wants every row. */
  unbounded: boolean
  /** The largest row count the binding asks for (its limit, its page size). */
  askedLimit: number
  /** The fields the binding filters, sorts or searches by. */
  fields: string[]
}

interface Accumulator {
  public: boolean
  anySession: boolean
  roles: Set<string>
  /** By the roles they admit (`''` for any session): the products, null for any. */
  subscriberRules: Map<string, Set<string> | null>
  /** The owner columns of the row-owned pages that bind the table. */
  ownerColumns: Set<string>
  fields: Set<string>
  unbounded: boolean
  askedLimit: number
}

type AnyRecord = Record<string, unknown>

const isRecord = (value: unknown): value is AnyRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const staticContent = (value: unknown): unknown =>
  isRecord(value) && value.type === 'static' ? value.content : value

const staticString = (value: unknown): string | null => {
  const content = staticContent(value)
  return typeof content === 'string' && content.length > 0 ? content : null
}

const staticNumber = (value: unknown): number | null => {
  const content = staticContent(value)
  return typeof content === 'number' && isFinite(content) && content >= 0 ? content : null
}

/** The largest page size any repeater inside `value` shows. */
const largestPageSize = (value: unknown): number => {
  let largest = 0
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!isRecord(node)) {
      return
    }
    if (node.type === 'cms-list-repeater' && isRecord(node.content)) {
      const perPage = staticNumber(node.content.perPage)
      if (perPage !== null) {
        largest = Math.max(largest, perPage)
      }
    }
    Object.keys(node).forEach((key) => visit(node[key]))
  }
  visit(value)
  return largest
}

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
// A field named inside an expression (a filter built at run time): `"source":"col"`.
const FIELD_IN_EXPRESSION = /\\?"(?:source|field)\\?"\s*:\s*\\?"([A-Za-z_][A-Za-z0-9_]*)\\?"/g

/** The fields a binding's own params and repeaters filter, sort or search by. */
const bindingFields = (...values: unknown[]): string[] => {
  const fields = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && FIELD_NAME.test(value)) {
      fields.add(value)
    }
  }
  const visit = (node: unknown, key?: string) => {
    if (Array.isArray(node)) {
      node.forEach((entry) =>
        key === 'queryColumns' || key === 'content' ? add(entry) : undefined
      )
      node.forEach((entry) => visit(entry, key))
      return
    }
    if (typeof node === 'string') {
      if (key === 'source' || key === 'field' || key === 'sort') {
        add(node)
      }
      let match = FIELD_IN_EXPRESSION.exec(node)
      while (match) {
        fields.add(match[1])
        match = FIELD_IN_EXPRESSION.exec(node)
      }
      FIELD_IN_EXPRESSION.lastIndex = 0
      return
    }
    if (!isRecord(node)) {
      return
    }
    Object.keys(node).forEach((child) => visit(node[child], child === 'content' ? key : child))
  }
  values.forEach((value) => visit(value))
  return Array.from(fields)
}

/**
 * Every table `root` binds, following the components it renders. A walk over
 * the whole JSON rather than over known node shapes: a binding kind added later
 * is still found as long as it names its source and table the way every one
 * does today.
 */
const collectBindings = (
  root: unknown,
  uidl: ProjectUIDL,
  componentBindings: Map<string, Binding[]>,
  componentsInProgress: Set<string>
): Binding[] => {
  const bindings: Binding[] = []
  const resources = ((uidl.resources && uidl.resources.items) || {}) as unknown as Record<
    string,
    AnyRecord
  >
  const components = uidl.components || {}

  const resourceBinding = (id: string): Binding | null => {
    const item = resources[id]
    if (!item || !isRecord(item.params)) {
      return null
    }
    const table = staticString(item.params.tableName)
    const dataSourceId = staticString(item.params.dataSourceId)
    if (!table && !dataSourceId) {
      return null
    }
    return {
      dataSourceId,
      table,
      unbounded: false,
      askedLimit: 0,
      fields: bindingFields(item.params),
    }
  }

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!isRecord(node)) {
      return
    }

    const content = isRecord(node.content) ? node.content : null

    // A data provider (list or single item).
    if (
      (node.type === 'data-source-list' || node.type === 'data-source-item') &&
      content &&
      isRecord(content.resourceDefinition)
    ) {
      const definition = content.resourceDefinition
      const resource = isRecord(content.resource) ? content.resource : null
      const params = resource && isRecord(resource.params) ? resource.params : {}
      const resourceItem =
        resource && typeof resource.id === 'string' ? resources[resource.id] : null
      const itemParams = resourceItem && isRecord(resourceItem.params) ? resourceItem.params : {}
      const limit = staticNumber(params.limit) ?? staticNumber(itemParams.limit)
      const askedLimit = Math.max(
        limit || 0,
        largestPageSize(content.nodes),
        largestPageSize(content.children)
      )
      bindings.push({
        dataSourceId: staticString(definition.dataSourceId),
        table: staticString(definition.tableName),
        // Neither a limit of its own nor a page size: the list shows every row.
        unbounded: node.type === 'data-source-list' && askedLimit === 0,
        askedLimit,
        fields: bindingFields(params, itemParams, content.nodes),
      })
    }

    // A details page's entity, a resource definition anywhere else, a
    // workflow-free table reference: an object naming its source and table.
    if (typeof node.tableName === 'string' && typeof node.dataSourceId === 'string') {
      bindings.push({
        dataSourceId: node.dataSourceId,
        table: node.tableName,
        unbounded: false,
        askedLimit: 0,
        // A details page reads its row by this column.
        fields:
          typeof node.differentiatorColumn === 'string' &&
          FIELD_NAME.test(node.differentiatorColumn)
            ? [node.differentiatorColumn]
            : [],
      })
    }

    // A state seeded from a table: the table is its refPath's first segment.
    if (isRecord(node.dataSourceBinding)) {
      const binding = node.dataSourceBinding
      const refPath = Array.isArray(binding.refPath) ? binding.refPath : []
      bindings.push({
        dataSourceId: typeof binding.dataSourceId === 'string' ? binding.dataSourceId : null,
        table: typeof refPath[0] === 'string' ? refPath[0] : null,
        unbounded: false,
        askedLimit: 0,
        fields: [],
      })
    }

    // A resource the page reads (static props, static paths, a CMS list).
    if (typeof node.id === 'string' && Object.prototype.hasOwnProperty.call(resources, node.id)) {
      const binding = resourceBinding(node.id)
      if (binding) {
        bindings.push(binding)
      }
    }

    // A component the page renders binds what the component binds.
    if (node.type === 'element' && content && isRecord(content.dependency)) {
      const name =
        content.dependency.type === 'local'
          ? [content.semanticType, content.elementType].find(
              (candidate): candidate is string =>
                typeof candidate === 'string' &&
                Object.prototype.hasOwnProperty.call(components, candidate)
            )
          : undefined
      if (name) {
        bindings.push(...componentBindingsOf(name))
      }
    }

    Object.keys(node).forEach((key) => visit(node[key]))
  }

  const componentBindingsOf = (name: string): Binding[] => {
    const known = componentBindings.get(name)
    if (known) {
      return known
    }
    if (componentsInProgress.has(name)) {
      return []
    }
    componentsInProgress.add(name)
    const found = collectBindings(
      (components as Record<string, unknown>)[name],
      uidl,
      componentBindings,
      componentsInProgress
    )
    componentsInProgress.delete(name)
    componentBindings.set(name, found)
    return found
  }

  visit(root)
  return bindings
}

/**
 * The route a page is served from, as the project generator writes it into
 * the route's `pageOptions.navLink` (`createPageUIDLs`). A route without one —
 * a UIDL read before that pass — is rebuilt the way that pass builds it.
 */
const pageRouteOf = (value: string, pageOptions: AnyRecord, isHomePage: boolean): string => {
  if (typeof pageOptions.navLink === 'string' && pageOptions.navLink.length > 0) {
    return pageOptions.navLink
  }
  if (pageOptions.fallback) {
    return '**'
  }
  const segments = value.split('/')
  const fileName = camelCaseToDashCase(removeIllegalCharacters(segments[segments.length - 1]) || '')
  if (typeof pageOptions.dynamicRouteAttribute === 'string' && !isHomePage) {
    const staticPath = segments.length > 1 ? segments.slice(0, -1).join('/') : fileName
    return `/${staticPath}/[${pageOptions.dynamicRouteAttribute}]`
  }
  return isHomePage ? '/' : `/${fileName}`
}

const newAccumulator = (): Accumulator => ({
  public: false,
  anySession: false,
  roles: new Set<string>(),
  subscriberRules: new Map<string, Set<string> | null>(),
  ownerColumns: new Set<string>(),
  fields: new Set<string>(),
  unbounded: false,
  askedLimit: 0,
})

/**
 * What a page demands, for the tables it binds: its middleware policy, or —
 * for a row-owned (self-guarded) details page, which the middleware lets
 * through because its own SQL is the gate — a session whose user owns the row.
 */
type BindingPolicy = PageAccessPolicy & { ownerColumn?: string }

const record = (
  map: Map<string, Accumulator>,
  key: string | null,
  policy: BindingPolicy | null,
  binding: Binding
) => {
  if (!key) {
    return
  }
  const entry = map.get(key) || newAccumulator()
  if (!policy) {
    entry.public = true
  } else if (policy.ownerColumn) {
    entry.ownerColumns.add(policy.ownerColumn)
  } else if (policy.requiresSubscription) {
    // A subscriber-only page admits its sessions only with the entitlement.
    const rolesKey = Array.from(new Set(policy.allowedRoles || []))
      .sort()
      .join(',')
    const productIds = (policy.subscriptionProductIds || []).filter((id) => !!id)
    const known = entry.subscriberRules.get(rolesKey)
    if (known === null || productIds.length === 0) {
      entry.subscriberRules.set(rolesKey, null)
    } else {
      const merged = new Set<string>(productIds)
      if (known) {
        known.forEach((id) => merged.add(id))
      }
      entry.subscriberRules.set(rolesKey, merged)
    }
  } else if ((policy.allowedRoles || []).length === 0) {
    entry.anySession = true
  } else {
    policy.allowedRoles.forEach((role) => entry.roles.add(role))
  }
  binding.fields.forEach((field) => entry.fields.add(field))
  entry.unbounded = entry.unbounded || binding.unbounded
  entry.askedLimit = Math.max(entry.askedLimit, binding.askedLimit)
  map.set(key, entry)
}

const finish = (map: Map<string, Accumulator>): Record<string, DataReadExposure> => {
  const out: Record<string, DataReadExposure> = {}
  map.forEach((entry, key) => {
    const maxLimit = Math.max(BROWSER_READ_MAX_LIMIT, Math.ceil(entry.askedLimit))
    const open = entry.public || entry.anySession
    const subscriberRules = open
      ? []
      : Array.from(entry.subscriberRules.entries()).map(([rolesKey, productIds]) => ({
          roles: rolesKey ? rolesKey.split(',') : [],
          productIds: productIds ? Array.from(productIds).sort() : [],
        }))
    const ownerRules = open
      ? []
      : Array.from(entry.ownerColumns)
          .sort()
          .map((column) => ({ column }))
    out[key] = {
      public: entry.public,
      anySession: !entry.public && entry.anySession,
      roles: open ? [] : Array.from(entry.roles).sort(),
      ...(subscriberRules.length > 0 && { subscriberRules }),
      ...(ownerRules.length > 0 && { ownerRules }),
      ...(entry.fields.size > 0 && { fields: Array.from(entry.fields).sort() }),
      defaultLimit: entry.unbounded ? maxLimit : BROWSER_READ_DEFAULT_LIMIT,
      maxLimit,
    }
  })
  return out
}

const computed = new WeakMap<object, ProjectDataExposure>()

/** A binding that names no data source is recorded under every source's name for its table. */
const ANY_SOURCE = '*'

/** The key of a table in `ProjectDataExposure.tables`: its data source and its bare name. */
export const tableExposureKey = (
  dataSourceId: string | null | undefined,
  tableName: string
): string => `${dataSourceId || ANY_SOURCE}:${bareTableName(tableName)}`

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The owner column of the row-owned (self-guarded) details page served at
 * `route`, or null: a page the middleware lets every visitor through to — by
 * its own self-guarded route patterns (`selfGuardedOwnerColumnAt`) — and whose
 * own SQL decides whose row is shown.
 */
const rowOwnerColumnOf = (
  auth: UIDLAuthentication,
  routeTable: ProtectedRouteTable,
  route: string
): string | null => {
  const column = selfGuardedOwnerColumnAt(auth, routeTable, route)
  return column && IDENTIFIER.test(column) ? column : null
}

/** The exposure of every table and data source `uidl`'s pages bind. */
export const resolveDataExposure = (uidl: ProjectUIDL): ProjectDataExposure => {
  const known = computed.get(uidl)
  if (known) {
    return known
  }

  const auth = uidl.authentication as UIDLAuthentication | undefined
  const routeTable: ProtectedRouteTable | null =
    auth && auth.enabled === true ? buildProtectedRouteTable(auth) : null
  const policyOf = (route: string): BindingPolicy | null => {
    if (!routeTable) {
      return null
    }
    const policy = resolveRouteAccessPolicy(routeTable, route)
    if (policy) {
      return policy
    }
    const ownerColumn = rowOwnerColumnOf(auth as UIDLAuthentication, routeTable, route)
    return ownerColumn ? { requiresAuth: true, allowedRoles: [], ownerColumn } : null
  }

  const tables = new Map<string, Accumulator>()
  const dataSources = new Map<string, Accumulator>()
  const componentBindings = new Map<string, Binding[]>()
  const bind = (subtree: unknown, policy: BindingPolicy | null) => {
    collectBindings(subtree, uidl, componentBindings, new Set()).forEach((binding) => {
      record(
        tables,
        binding.table ? tableExposureKey(binding.dataSourceId, binding.table) : null,
        policy,
        binding
      )
      record(dataSources, binding.dataSourceId, policy, binding)
    })
  }

  const root = uidl.root
  const rootElement =
    root && isRecord(root.node) && isRecord(root.node.content) ? root.node.content : null
  const routeDefinition = root && root.stateDefinitions && root.stateDefinitions.route
  const routeValues = (routeDefinition && Array.isArray(routeDefinition.values)
    ? routeDefinition.values
    : []) as unknown as AnyRecord[]
  const children = rootElement && Array.isArray(rootElement.children) ? rootElement.children : []

  const isRouteNode = (child: unknown): boolean =>
    isRecord(child) &&
    child.type === 'conditional' &&
    isRecord(child.content) &&
    isRecord(child.content.reference) &&
    child.content.reference.type === 'dynamic' &&
    isRecord(child.content.reference.content) &&
    child.content.reference.content.id === 'route'

  // Every page, behind its own protection: its route definition (the page's
  // options) and its node, whichever of the two the UIDL carries.
  const routeNodes = children
    .filter(isRouteNode)
    .map((child) => (child as unknown as AnyRecord).content as AnyRecord)
  const pageValues = Array.from(
    new Set([
      ...routeValues
        .filter((entry) => entry && entry.value !== undefined)
        .map((entry) => entry.value),
      ...routeNodes.map((content) => content.value),
    ])
  )
  pageValues.forEach((pageValue) => {
    const definition = routeValues.find((entry) => entry && entry.value === pageValue) || {}
    const pageOptions = isRecord(definition.pageOptions) ? definition.pageOptions : {}
    const isHomePage = !!routeDefinition && routeDefinition.defaultValue === pageValue
    const policy = policyOf(pageRouteOf(String(pageValue), pageOptions, isHomePage))
    routeNodes
      .filter((content) => content.value === pageValue)
      .forEach((content) => bind(content.node, policy))
    bind(pageOptions, policy)
  })

  // The layout every page shares, the root's own states and the app-wide
  // global states: in front of every visitor.
  children.filter((child) => !isRouteNode(child)).forEach((child) => bind(child, null))
  if (root && root.stateDefinitions) {
    Object.keys(root.stateDefinitions)
      .filter((key) => key !== 'route')
      .forEach((key) => bind(root.stateDefinitions[key], null))
  }
  bind(uidl.globalStateDefinitions, null)

  const exposure: ProjectDataExposure = { tables: finish(tables), dataSources: finish(dataSources) }
  computed.set(uidl, exposure)
  return exposure
}

/**
 * The exposure of the table a read route serves — `CLOSED_READ_EXPOSURE`
 * when nothing decided it (no project around the route, or no page binds the
 * table): the route then serves the app's own server code only.
 */
export const readExposureFor = (
  exposure: ProjectDataExposure | undefined | null,
  params: { tableName: string; dataSourceId?: string; dataSourceType?: string }
): DataReadExposure => {
  if (!exposure) {
    return CLOSED_READ_EXPOSURE
  }
  if (isSourceWithoutTables(params.dataSourceType || '') || !params.tableName) {
    const bySource = params.dataSourceId ? exposure.dataSources[params.dataSourceId] : undefined
    return bySource || CLOSED_READ_EXPOSURE
  }
  const tables = exposure.tables || {}
  if (params.dataSourceId) {
    // This source's table, else a binding that named no source.
    return (
      tables[tableExposureKey(params.dataSourceId, params.tableName)] ||
      tables[tableExposureKey(null, params.tableName)] ||
      CLOSED_READ_EXPOSURE
    )
  }
  // No source named: only an unambiguous entry answers.
  const suffix = ':' + bareTableName(params.tableName)
  const matches = Object.keys(tables).filter((key) => key.slice(-suffix.length) === suffix)
  return matches.length === 1 ? tables[matches[0]] : CLOSED_READ_EXPOSURE
}

/**
 * ES5 source of `__dxEntitled(token, productIds)`: whether the session's user
 * holds an entitled subscription — to one of `productIds`, or to any product
 * when the list is empty — by the one entitlement query the subscriber-access
 * route and the page guard run (`SubscriptionAccess.SUBSCRIPTION_ENTITLEMENT_SQL`).
 * It reads the TeleportHQ database, where subscriptions live, on a connection
 * of its own; any failure (no database, no driver, an error) answers false.
 */
export const generateEntitlementCheckCode =
  (): string => `// GENERATED — see generateEntitlementCheckCode in teleport-shared data-exposure.ts.
var __DX_ENTITLED_STATUSES = ${JSON.stringify(SUBSCRIPTION_ENTITLED_STATUSES)};
var __DX_ENTITLEMENT_SQL = ${JSON.stringify(SUBSCRIPTION_ENTITLEMENT_SQL)};
async function __dxEntitled(token, productIds) {
  var userId = token && (token.id || token.sub);
  if (!userId) return false;
  var connectionString = process.env.TELEPORT_DB_CONNECTION_STRING;
  if (!connectionString && !process.env.TELEPORT_DB_HOST) return false;
  var pg;
  try {
    pg = require('pg');
  } catch (e) {
    return false;
  }
  var sslEnv = process.env.TELEPORT_DB_SSL;
  var config = connectionString
    ? { connectionString: connectionString }
    : {
        host: process.env.TELEPORT_DB_HOST,
        port: parseInt(process.env.TELEPORT_DB_PORT || '5432', 10),
        user: process.env.TELEPORT_DB_USER,
        password: process.env.TELEPORT_DB_PASSWORD,
        database: process.env.TELEPORT_DB_NAME,
      };
  config.query_timeout = ${READ_QUERY_TIMEOUT_MS};
  if (sslEnv === 'false') config.ssl = false;
  if (sslEnv === 'true') config.ssl = { rejectUnauthorized: false };
  var client = new pg.Client(config);
  try {
    await client.connect();
    var result = await client.query(__DX_ENTITLEMENT_SQL, [String(userId), __DX_ENTITLED_STATUSES, productIds || []]);
    return !!(result && result.rows && result.rows.length > 0);
  } catch (e) {
    console.error('[data-exposure] the subscription check failed:', e && e.message ? e.message : e);
    return false;
  } finally {
    try { await client.end(); } catch (e) {}
  }
}
`
