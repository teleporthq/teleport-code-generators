import { DataExposure, SessionCookieResolver, TableAccess } from '@teleporthq/teleport-shared'
import { replaceSecretReference } from '../utils'
import { PG_CLIENT_IMPORT } from './pg-client-import'

/**
 * What a raw-query state route is behind: the protection of the page it
 * serves (`PageAccess.resolvePageAccessPolicy`; null for a page every visitor
 * may open, and for an app-wide global state), and the roles that may read the
 * protected tables (`TableAccess.resolveTrustedReaderRoles`).
 */
export interface RawQueryRouteAccess {
  pageAccess?: {
    requiresAuth: boolean
    allowedRoles: string[]
    requiresSubscription?: boolean
    subscriptionProductIds?: string[]
  } | null
  trustedReaderRoles?: string[]
  /** The route's path back to the project root; absent, three folders (`pages/api/page-state/`, `pages/api/global-state/`). */
  projectRoot?: string
  /** The project has authentication: the session reader checks revocation (absent: it does). */
  withRevocation?: boolean
}

/** The longest value a request may bind into the statement (a route param). */
const MAX_REQUEST_PARAM_LENGTH = 256

/** The largest row count the baked statement asks for itself (`LIMIT n` at its end), or 0. */
const statementLimit = (query: string): number => {
  const match = /\blimit\s+(\d+)\s*(?:offset\s+\d+\s*)?;?\s*$/i.exec(query)
  return match ? parseInt(match[1], 10) : 0
}

interface PostgreSQLConfig {
  host?: string
  port?: number
  user?: string
  username?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
}

const FORBIDDEN_KEYWORDS = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE']

/** The param a `{{Current User.<field>}}` token becomes: `currentUser` + the field, capitalised. */
const CURRENT_USER_PARAM_PREFIX = 'currentUser'

const isCurrentUserParam = (param: string): boolean =>
  param.length > CURRENT_USER_PARAM_PREFIX.length && param.indexOf(CURRENT_USER_PARAM_PREFIX) === 0

/** The user field a `currentUser<Field>` param stands for (`currentUserId` → `id`). */
const currentUserField = (param: string): string => {
  const rest = param.slice(CURRENT_USER_PARAM_PREFIX.length)
  return rest.charAt(0).toLowerCase() + rest.slice(1)
}

/**
 * Generates an API route handler that executes a parameterized raw SQL query.
 * Supports {{Current User.*}} substitution — bound to the SESSION's user.
 *
 * ⛔ A `{{Current User.<field>}}` value is read from the signed-in session on
 * the server, never from the request: the query string is whatever the caller
 * wrote, so a route that bound `?currentUserId=` served any user's rows (their
 * favourites, their orders) to anyone who named that user's id. A caller with
 * no session gets no rows, exactly as when the value is missing. Other params
 * (`currentPageEntityId`, the details page's route param) stay request values.
 *
 * @param config - PostgreSQL connection config
 * @param query - Raw SQL query string with {{Current User.*}} patterns already replaced to $N placeholders
 * @param paramFields - Array of query param field names that map to $1, $2, etc. in order
 */
export const generateRawQueryFetcher = (
  config: Record<string, unknown>,
  query: string,
  paramFields: string[],
  access: RawQueryRouteAccess = {}
): string => {
  const pgConfig = config as PostgreSQLConfig
  const userParams = paramFields.filter(isCurrentUserParam)
  const requestParams = paramFields.filter((param) => !isCurrentUserParam(param))
  const pageAccess = access.pageAccess || null
  const rowCap = Math.max(DataExposure.BROWSER_READ_MAX_LIMIT, statementLimit(query))

  const paramDestructure = [
    requestParams.length > 0
      ? `const { ${requestParams
          .map((param) => `${param}: __raw_${param}`)
          .join(', ')} } = req.query\n    ${requestParams
          .map((param) => `const ${param} = requestParam(__raw_${param})`)
          .join('\n    ')}`
      : '',
    userParams.length > 0 ? 'const __sessionUser = await sessionUser(req)' : '',
    ...userParams.map(
      (param) =>
        `const ${param} = sessionUserField(__sessionUser, ${JSON.stringify(
          currentUserField(param)
        )})`
    ),
  ]
    .filter(Boolean)
    .join('\n    ')

  // Every route carries the session resolver and the table-access helpers: the
  // page's protection, the protected tables and the credential columns are
  // checked here as on every other read route.
  // The route lives in pages/api/page-state/ or pages/api/global-state/: three folders below the root.
  const projectRoot = access.projectRoot || '../../..'
  const sessionHelpers = `${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(
    projectRoot,
    {
      withRevocation: access.withRevocation !== false,
    }
  )}
${TableAccess.generateTableAccessHelperCode({
  trustedReaderRoles: access.trustedReaderRoles || [],
  projectRoot,
})}
// The signed-in user this request's session names, or null.
async function sessionUser(req) {
  try {
    return await __tqSessionToken(req)
  } catch (e) {
    return null
  }
}

// One field of that user, as the session carries it (the token is seeded from
// the users row), or undefined. The id is the token's subject when not copied.
function sessionUserField(user, field) {
  if (!user) return undefined
  var value = field === 'id' && user.id == null ? user.sub : user[field]
  return value == null || value === '' ? undefined : value
}

// A value the request binds into the statement (a details page's route param):
// one short string, never a list or an object.
function requestParam(value) {
  if (Array.isArray(value)) value = value[0]
  if (value === undefined || value === null) return undefined
  var text = String(value)
  return text.length > 0 && text.length <= ${MAX_REQUEST_PARAM_LENGTH} ? text : undefined
}

// Who may run this route's statement: the visitors the page it serves admits
// (PAGE_ACCESS, null for every visitor), and — when the statement reads a
// protected table — only the app's own server code, a trusted role, or a
// session the statement itself is scoped to (a {{Current User.*}} value bound
// from that session above). null when the request may proceed.
var PAGE_ACCESS = ${JSON.stringify(
    pageAccess
      ? {
          allowedRoles: pageAccess.allowedRoles || [],
          requiresSubscription: pageAccess.requiresSubscription === true,
          subscriptionProductIds: pageAccess.subscriptionProductIds || [],
        }
      : null
  )}
${pageAccess && pageAccess.requiresSubscription ? DataExposure.generateEntitlementCheckCode() : ''}
var SESSION_SCOPED = ${JSON.stringify(userParams.length > 0)}
var ROW_CAP = ${rowCap}
// No query waits on the database longer than this (enforced by the client:
// a server-side statement_timeout does not survive a pooler).
var QUERY_TIMEOUT_MS = ${DataExposure.READ_QUERY_TIMEOUT_MS}
async function guardStatement(req, query) {
  // A retired table is reached by no caller, this app's own server code included.
  if (__taRetiredTableNamed(null, query)) return { status: 403, message: 'Forbidden' }
  if (__taIsInternalRequest(req)) return null
  var token = await sessionUser(req)
  var role = token ? __taRoleOf(token) : null
  if (PAGE_ACCESS) {
    if (!token) return { status: 401, message: 'Unauthenticated' }
    if (PAGE_ACCESS.allowedRoles.length > 0 && (!role || PAGE_ACCESS.allowedRoles.indexOf(role) === -1)) {
      return { status: 403, message: 'Forbidden' }
    }
    // A subscriber-only page: its states too need the entitlement.
    if (PAGE_ACCESS.requiresSubscription && !(await __dxEntitled(token, PAGE_ACCESS.subscriptionProductIds))) {
      return { status: 403, message: 'Forbidden' }
    }
  }
  if (__taProtectedTablesRead(null, query).length === 0) return null
  if (role && __TA_TRUSTED_READER_ROLES.indexOf(role) !== -1) return null
  // Scoped to the session's own value: without a session the statement never
  // runs (no value to bind), and the request is answered with no rows.
  if (SESSION_SCOPED) return null
  return token ? { status: 403, message: 'Forbidden' } : { status: 401, message: 'Unauthenticated' }
}
`

  const paramValidation =
    paramFields.length > 0
      ? `
    if (${paramFields.map((f) => `!${f}`).join(' || ')}) {
      return res.status(200).json({ success: true, data: [], timestamp: Date.now() })
    }`
      : ''

  const paramArray = paramFields.length > 0 ? `[${paramFields.join(', ')}]` : '[]'

  const sslValue =
    pgConfig.ssl === false
      ? 'false'
      : pgConfig.ssl === true || pgConfig.sslConfig
      ? pgConfig.sslConfig
        ? `{
      ${pgConfig.sslConfig.ca ? `ca: ${replaceSecretReference(pgConfig.sslConfig.ca)},` : ''}
      ${pgConfig.sslConfig.cert ? `cert: ${replaceSecretReference(pgConfig.sslConfig.cert)},` : ''}
      ${pgConfig.sslConfig.key ? `key: ${replaceSecretReference(pgConfig.sslConfig.key)},` : ''}
      rejectUnauthorized: false
    }`
        : '{ rejectUnauthorized: false }'
      : 'false'

  return `${PG_CLIENT_IMPORT}

const FORBIDDEN_KEYWORDS = ${JSON.stringify(FORBIDDEN_KEYWORDS)}
${sessionHelpers}
const getClient = () => {
  const connStr = process.env.TELEPORT_DB_CONNECTION_STRING
  if (connStr) {
    const sslEnv = process.env.TELEPORT_DB_SSL
    const sslOpt = sslEnv === 'false' ? false : sslEnv === 'true' ? { rejectUnauthorized: false } : undefined
    return new Client(Object.assign({ connectionString: connStr, query_timeout: QUERY_TIMEOUT_MS }, sslOpt !== undefined ? { ssl: sslOpt } : {}))
  }
  return new Client({
    query_timeout: QUERY_TIMEOUT_MS,
    host: process.env.TELEPORT_DB_HOST || ${JSON.stringify(pgConfig.host ?? null)},
    port: parseInt(process.env.TELEPORT_DB_PORT || '${pgConfig.port || 5432}', 10),
    user: process.env.TELEPORT_DB_USER || ${JSON.stringify(
      pgConfig.user ?? pgConfig.username ?? null
    )},
    password: process.env.TELEPORT_DB_PASSWORD || ${
      replaceSecretReference(pgConfig.password) !== 'undefined'
        ? replaceSecretReference(pgConfig.password)
        : 'null'
    },
    database: process.env.TELEPORT_DB_NAME || ${JSON.stringify(pgConfig.database ?? null)},
    ssl: ${sslValue}
  })
}

const validateQuery = (query) => {
  const trimmed = query.trim().toUpperCase()
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (trimmed.startsWith(keyword)) {
      return false
    }
  }
  return true
}

export default async function handler(req, res) {
  try {
    const query = ${JSON.stringify(query)}
    const __denied = await guardStatement(req, query)
    if (__denied) {
      return res.status(__denied.status).json({ success: false, error: __denied.message, timestamp: Date.now() })
    }
    ${paramDestructure}
    ${paramValidation}

    if (!validateQuery(query)) {
      return res.status(400).json({
        success: false,
        error: 'Only SELECT queries are allowed',
        timestamp: Date.now()
      })
    }

    const client = getClient()
    await client.connect()

    try {
      const result = await client.query(query, ${paramArray})
      const rows = Array.isArray(result && result.rows) ? result.rows : []

      return res.status(200).json({
        success: true,
        // No credential column leaves in a row, and a browser gets at most
        // ROW_CAP rows (the statement's own LIMIT when it asks for more).
        data: __taWithoutCredentials(__taIsInternalRequest(req) ? rows : rows.slice(0, ROW_CAP), null),
        timestamp: Date.now()
      })
    } finally {
      await client.end()
    }
  } catch (error) {
    // A database error names tables, columns and values: server log only,
    // under the reference the client gets.
    const id = Math.floor(Math.random() * 0xffffffff).toString(16)
    console.error('Raw query fetch error (' + id + '):', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch data',
      id: id,
      timestamp: Date.now()
    })
  }
}
`
}

/**
 * Parses a SQL query string for {{Current User.*}} template patterns.
 * Returns the parameterized query and an ordered list of field names.
 */
export const parseQueryTemplateVariables = (
  query: string
): { parameterizedQuery: string; paramFields: string[] } => {
  const captureRe = /\{\{Current User\.(\w+)\}\}/g
  const paramFields: string[] = []

  // First pass: collect unique fields in order
  const tempRe = new RegExp(captureRe.source, 'g')
  let match = tempRe.exec(query)
  while (match !== null) {
    const field = match[1]
    if (!paramFields.includes(field)) {
      paramFields.push(field)
    }
    match = tempRe.exec(query)
  }

  // Second pass: replace patterns with $N placeholders
  let parameterizedQuery = query
  for (let i = 0; i < paramFields.length; i++) {
    const field = paramFields[i]
    // Replace both quoted ('{{...}}') and unquoted ({{...}}) variants
    const quotedPattern = `'{{Current User.${field}}}'`
    const unquotedPattern = `{{Current User.${field}}}`

    if (parameterizedQuery.includes(quotedPattern)) {
      parameterizedQuery = parameterizedQuery.split(quotedPattern).join(`$${i + 1}`)
    } else {
      parameterizedQuery = parameterizedQuery.split(unquotedPattern).join(`$${i + 1}`)
    }
  }

  // Convert field names to camelCase query param names
  const queryParamNames = paramFields.map(
    (f) => `currentUser${f.charAt(0).toUpperCase() + f.slice(1)}`
  )

  return { parameterizedQuery, paramFields: queryParamNames }
}
