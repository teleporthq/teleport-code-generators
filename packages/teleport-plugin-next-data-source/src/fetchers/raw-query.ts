import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { replaceSecretReference } from '../utils'

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
  paramFields: string[]
): string => {
  const pgConfig = config as PostgreSQLConfig
  const userParams = paramFields.filter(isCurrentUserParam)
  const requestParams = paramFields.filter((param) => !isCurrentUserParam(param))

  const paramDestructure = [
    requestParams.length > 0 ? `const { ${requestParams.join(', ')} } = req.query` : '',
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

  const sessionHelpers =
    userParams.length > 0
      ? `${SessionCookieResolver.generateCommonJsSessionTokenResolverCode()}
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
`
      : ''

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

  return `import { Client } from 'pg'

const FORBIDDEN_KEYWORDS = ${JSON.stringify(FORBIDDEN_KEYWORDS)}
${sessionHelpers}
const getClient = () => {
  const connStr = process.env.TELEPORT_DB_CONNECTION_STRING
  if (connStr) {
    const sslEnv = process.env.TELEPORT_DB_SSL
    const sslOpt = sslEnv === 'false' ? false : sslEnv === 'true' ? { rejectUnauthorized: false } : undefined
    return new Client(Object.assign({ connectionString: connStr }, sslOpt !== undefined ? { ssl: sslOpt } : {}))
  }
  return new Client({
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
    ${paramDestructure}
    ${paramValidation}

    const query = ${JSON.stringify(query)}

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

      return res.status(200).json({
        success: true,
        data: result.rows,
        timestamp: Date.now()
      })
    } finally {
      await client.end()
    }
  } catch (error) {
    // A database error names tables, columns and values: server log only.
    console.error('Raw query fetch error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch data',
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
