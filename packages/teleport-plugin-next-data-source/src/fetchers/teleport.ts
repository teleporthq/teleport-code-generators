import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateSearchEscapeHelpersCode,
} from '../utils'
import {
  getTransformationCode,
  getTransformExpression,
  getTransformWrapperCode,
  type EcommerceProductTransformOptions,
} from '../transformations'

interface TeleportDBConfig {
  host?: string
  port?: number | string
  user?: string
  username?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  options?: { schema?: string }
}

const DEFAULT_ENV_KEYS = {
  host: 'TELEPORT_DB_HOST',
  port: 'TELEPORT_DB_PORT',
  user: 'TELEPORT_DB_USER',
  password: 'TELEPORT_DB_PASSWORD',
  database: 'TELEPORT_DB_NAME',
  ssl: 'TELEPORT_DB_SSL',
}

const resolveEnvReference = (value: unknown, defaultEnvKey: string): string => {
  if (typeof value === 'string' && value.startsWith('teleporthq.secrets.')) {
    return replaceSecretReference(value)
  }
  return `process.env.${defaultEnvKey}`
}

export const validateTeleportConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  return { isValid: true }
}

export const generateTeleportFetcher = (
  config: Record<string, unknown>,
  tableName: string,
  transformOptions: EcommerceProductTransformOptions = {}
): string => {
  const dbConfig = config as TeleportDBConfig
  const schema = dbConfig.options?.schema

  const hostRef = resolveEnvReference(dbConfig.host, DEFAULT_ENV_KEYS.host)
  const portRef = resolveEnvReference(dbConfig.port, DEFAULT_ENV_KEYS.port)
  const userRef = resolveEnvReference(dbConfig.user || dbConfig.username, DEFAULT_ENV_KEYS.user)
  const passwordRef = resolveEnvReference(dbConfig.password, DEFAULT_ENV_KEYS.password)
  const databaseRef = resolveEnvReference(dbConfig.database, DEFAULT_ENV_KEYS.database)

  const sslCode =
    dbConfig.ssl === false
      ? 'false'
      : dbConfig.sslConfig
      ? `{
      ${
        dbConfig.sslConfig.ca
          ? `ca: ${resolveEnvReference(dbConfig.sslConfig.ca, 'TELEPORT_DB_SSL_CA')},`
          : ''
      }
      ${
        dbConfig.sslConfig.cert
          ? `cert: ${resolveEnvReference(dbConfig.sslConfig.cert, 'TELEPORT_DB_SSL_CERT')},`
          : ''
      }
      ${
        dbConfig.sslConfig.key
          ? `key: ${resolveEnvReference(dbConfig.sslConfig.key, 'TELEPORT_DB_SSL_KEY')},`
          : ''
      }
      rejectUnauthorized: false
    }`
      : `(process.env.${DEFAULT_ENV_KEYS.ssl} === 'false' ? false : process.env.${DEFAULT_ENV_KEYS.ssl} === 'true' ? { rejectUnauthorized: false } : undefined)`

  return `import { Client } from 'pg'

function normalizePostgresConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return connectionString;
  if (/^postgresql:\\/(?!\\/)/i.test(connectionString)) {
    return connectionString.replace(/^postgresql:\\//i, 'postgresql://');
  }
  return connectionString;
}

function stripSslQueryParamsFromConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return connectionString;
  try {
    var u = new URL(connectionString.replace(/^postgresql:/i, 'postgres:'));
    u.searchParams.delete('sslmode');
    u.searchParams.delete('ssl');
    u.searchParams.delete('sslrootcert');
    u.searchParams.delete('sslcert');
    u.searchParams.delete('sslkey');
    return u.toString().replace(/^postgres:/i, 'postgresql:');
  } catch (e) {
    return connectionString;
  }
}

const getClient = () => {
  var ssl = ${sslCode};
  var connStr = process.env.TELEPORT_DB_CONNECTION_STRING;
  if (connStr) {
    connStr = normalizePostgresConnectionString(connStr);
  }
  if (ssl === false && connStr) {
    connStr = stripSslQueryParamsFromConnectionString(connStr);
  }
  if (connStr) {
    return new Client(Object.assign(
      { connectionString: connStr },
      ssl !== undefined ? { ssl: ssl } : {}
    ));
  }
  return new Client(Object.assign(
    {
      host: ${hostRef},
      port: parseInt(${portRef} || '5432', 10),
      user: ${userRef},
      password: ${passwordRef},
      database: ${databaseRef},
    },
    ssl !== undefined ? { ssl: ssl } : {}
  ));
}

${generateSafeJSONParseCode()}

${generateSearchEscapeHelpersCode()}
${getTransformationCode(tableName, transformOptions)}
${getTransformWrapperCode(tableName)}
const processFilters = (filters, conditions, queryParams, paramIndex) => {
  if (!filters) return paramIndex
  
  const parsedFilters = safeJSONParse(filters)
  
  if (Array.isArray(parsedFilters)) {
    parsedFilters.forEach((filter) => {
      if (!filter.source || filter.destination === undefined) return
      
      const field = filter.source
      const value = filter.destination
      const operand = filter.operand || '='
      
      if (Array.isArray(value)) {
        if (value.length === 0) return
        if (operand === 'array_overlap') {
          // Row column is a JSON array (e.g. category_ids). Match when it
          // shares any element with the destination set. jsonb ?| (function
          // form) avoids the '?' placeholder-token ambiguity some drivers hit.
          conditions.push(\`jsonb_exists_any(NULLIF(\${field}, '')::jsonb, $\${paramIndex}::text[])\`)
          queryParams.push(value.map((entry) => String(entry)))
          paramIndex++
          return
        }
        const placeholders = value.map(() => \`$\${paramIndex++}\`)
        queryParams.push(...value)
        if (operand === '!=') {
          conditions.push(\`\${field} NOT IN (\${placeholders.join(', ')})\`)
        } else {
          conditions.push(\`\${field} IN (\${placeholders.join(', ')})\`)
        }
      } else {
        if (operand === 'array_overlap') {
          if (value === '' || value === null || value === undefined) return
          // A single comma-joined string (the multi-select Category Filter's
          // ?categoryFilter=a,b,c) expands to multiple ids; one id stays one.
          const overlapValues = String(value).split(',').map((entry) => entry.trim()).filter(Boolean)
          if (overlapValues.length === 0) return
          conditions.push(\`jsonb_exists_any(NULLIF(\${field}, '')::jsonb, $\${paramIndex}::text[])\`)
          queryParams.push(overlapValues)
          paramIndex++
          return
        }
        if (value === null) {
          if (operand === '=') {
            conditions.push(\`\${field} IS NULL\`)
          } else if (operand === '!=') {
            conditions.push(\`\${field} IS NOT NULL\`)
          }
        } else {
          const validOps = ['=', '!=', '>', '<', '>=', '<=']
          const sqlOperator = validOps.includes(operand) ? operand : '='
          conditions.push(\`\${field} \${sqlOperator} $\${paramIndex}\`)
          queryParams.push(value)
          paramIndex++
        }
      }
    })
  } else {
    Object.entries(parsedFilters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        const placeholders = value.map(() => \`$\${paramIndex++}\`)
        queryParams.push(...value)
        conditions.push(\`\${key} IN (\${placeholders.join(', ')})\`)
      } else {
        conditions.push(\`\${key} = $\${paramIndex}\`)
        queryParams.push(value)
        paramIndex++
      }
    })
  }
  
  return paramIndex
}

${generateDateFormatterCode()}

// Matches DDL / dangerous statements the raw-query branch should refuse.
// Keep this list conservative — anything destructive or schema-changing is
// out of scope for a client-triggered fetch. SELECT and CTEs (WITH ...) are
// the only shapes consumers legitimately need.
const BLOCKED_RAW_QUERY_PATTERNS = [
  /\\bcreate\\s+(?:temporary\\s+|temp\\s+|unlogged\\s+|global\\s+|local\\s+)?table\\b/i,
  /\\bcreate\\s+(?:unique\\s+)?index\\b/i,
  /\\bcreate\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\b/i,
  /\\bcreate\\s+(?:or\\s+replace\\s+)?trigger\\b/i,
  /\\bcreate\\s+(?:or\\s+replace\\s+)?(?:aggregate\\s+)?function\\b/i,
  /\\bcreate\\s+(?:or\\s+replace\\s+)?procedure\\b/i,
  /\\bcreate\\s+(?:database|schema|sequence|extension|type|role|user)\\b/i,
  /\\bdrop\\s+(?:table|view|index|schema|database|sequence|trigger|function|procedure|role|user|extension|type|materialized)\\b/i,
  /\\balter\\s+(?:table|view|index|schema|database|sequence|role|user|system)\\b/i,
  /\\btruncate\\b/i,
  /\\bgrant\\b/i,
  /\\brevoke\\b/i,
  /\\binsert\\b/i,
  /\\bupdate\\b/i,
  /\\bdelete\\b/i,
  /\\bcopy\\b/i,
  /\\bvacuum\\b/i,
  /\\breindex\\b/i,
  /\\bcluster\\b/i,
]

function assertRawQuerySafe(rawQuery) {
  if (typeof rawQuery !== 'string' || rawQuery.length === 0) {
    throw new Error('rawQuery must be a non-empty string')
  }
  // Reject multi-statement payloads — only single SELECT / WITH statements.
  // A trailing semicolon is tolerated but any content after it fails.
  var trimmed = rawQuery.trim().replace(/;\\s*$/, '')
  if (trimmed.indexOf(';') !== -1) {
    throw new Error('rawQuery must contain exactly one statement')
  }
  for (var i = 0; i < BLOCKED_RAW_QUERY_PATTERNS.length; i++) {
    if (BLOCKED_RAW_QUERY_PATTERNS[i].test(trimmed)) {
      throw new Error('rawQuery contains a blocked statement')
    }
  }
}

export default async function handler(req, res) {
  const client = getClient()

  try {
    await client.connect()
    ${schema ? `await client.query('SET search_path TO ${schema}')` : ''}

    // If the caller supplied a rawQuery, run it verbatim (after a safety
    // guard). The schema-driven branch below builds \`SELECT * FROM ${tableName}\`
    // with optional filters — it's the default read path and ignores
    // rawQuery. Page-load workflows and other consumers that need a JOIN
    // or a user-scoped filter pass their fully-rendered SQL here via
    // \`fetchData({ rawQuery })\` and expect it to execute verbatim.
    if (req.query && typeof req.query.rawQuery === 'string' && req.query.rawQuery.length > 0) {
      assertRawQuerySafe(req.query.rawQuery)
      const rawResult = await client.query(req.query.rawQuery)
      const rawRows = Array.isArray(rawResult?.rows) ? rawResult.rows : []
      const rawPlain = rawRows.map((row) =>
        row && typeof row.toJSON === 'function' ? row.toJSON() : row
      )
      const rawSafe = JSON.parse(JSON.stringify(rawPlain, dateReplacer))
      return res.status(200).json({
        success: true,
        data: rawSafe,
        timestamp: Date.now()
      })
    }

    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    const conditions = []
    const queryParams = []
    let paramIndex = 1
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
      } else {
        try {
          const schemaQuery = \`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1
            ${schema ? `AND table_schema = $2` : ''}
            ORDER BY ordinal_position
          \`
          const schemaParams = ${
            schema
              ? `[${JSON.stringify(tableName)}, ${JSON.stringify(schema)}]`
              : `[${JSON.stringify(tableName)}]`
          }
          
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
        }
      }
      
      if (columns.length > 0) {
        const pattern = '%' + escapeLikePattern(query) + '%'
        const placeholder = '$' + paramIndex
        paramIndex++
        queryParams.push(pattern)
        const searchConditions = columns.map(
          (col) => '"' + sanitizeSearchIdentifier(col) + '"::text ILIKE ' + placeholder + " ESCAPE '|'"
        )
        conditions.push('(' + searchConditions.join(' OR ') + ')')
      }
    }
    
    paramIndex = processFilters(filters, conditions, queryParams, paramIndex)
    
    let sql = \`SELECT * FROM ${tableName}\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const orderClauses = parsedSorts.map((sort) => {
          if (!sort.field) return null
          const order = (sort.order || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'
          return \`\${sort.field} \${order}\`
        }).filter(Boolean)

        if (orderClauses.length > 0) {
          sql += \` ORDER BY \${orderClauses.join(', ')}\`
        }
      }
    } else if (sortBy) {
      sql += \` ORDER BY \${sortBy} \${(sortOrder || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (limitValue) {
      sql += \` LIMIT \${limitValue}\`
    }
    
    if (offsetValue !== undefined) {
      sql += \` OFFSET \${offsetValue}\`
    }
    
    const result = await client.query(sql, queryParams)
    const rows = Array.isArray(result?.rows) ? result.rows : []
    const plainRows = rows.map((row) =>
      row && typeof row.toJSON === 'function' ? row.toJSON() : row
    )
    const safeData = JSON.parse(JSON.stringify(plainRows, dateReplacer))
    ${
      getTransformExpression(tableName)
        ? `const transformedData = ${getTransformExpression(tableName)}`
        : ''
    }

    // Stamp each row with a globally-correct 1-based \`__rowNumber\` (the page
    // offset is applied server-side above), so list index columns keep counting
    // across pages instead of restarting at 1. Renderer-internal field — it is
    // filtered from ordinary field bindings and only read by the index column.
    const __finalData = ${getTransformExpression(tableName) ? 'transformedData' : 'safeData'}
    const __rowNumberStart = (typeof offsetValue === 'number' && !isNaN(offsetValue)) ? offsetValue : 0
    const __numberedData = Array.isArray(__finalData)
      ? __finalData.map((__row, __i) =>
          __row && typeof __row === 'object' && !Array.isArray(__row)
            ? Object.assign({}, __row, { __rowNumber: __rowNumberStart + __i + 1 })
            : __row)
      : __finalData

    return res.status(200).json({
      success: true,
      data: __numberedData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Teleport DB fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      try {
        await client.end()
      } catch (error) {
        console.error('Error closing database client:', error)
      }
    }
  }
}
`
}

export const generateTeleportCountFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const dbConfig = config as TeleportDBConfig
  const hasSchema = !!dbConfig.options?.schema

  return `
async function getCount(req, res) {
  const client = getClient()

  try {
    await client.connect()
    const { query, queryColumns, filters } = req.query
    const conditions = []
    const queryParams = []
    let paramIndex = 1

    if (query) {
      let columns = []
      
      if (queryColumns) {
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : [parsed]
      } else {
        try {
          const schemaQuery = \`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1
            ${hasSchema ? `AND table_schema = $2` : ''}
            ORDER BY ordinal_position
          \`
          const schemaParams = ${
            hasSchema
              ? `[${JSON.stringify(tableName)}, ${JSON.stringify(dbConfig.options!.schema)}]`
              : `[${JSON.stringify(tableName)}]`
          }
          
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
        }
      }
      
      if (columns.length > 0) {
        const pattern = '%' + escapeLikePattern(query) + '%'
        const placeholder = '$' + paramIndex
        paramIndex++
        queryParams.push(pattern)
        const searchConditions = columns
          .map(
            (col) => '"' + sanitizeSearchIdentifier(col) + '"::text ILIKE ' + placeholder + " ESCAPE '|'"
          )
          .join(' OR ')
        conditions.push('(' + searchConditions + ')')
      }
    }

    paramIndex = processFilters(filters, conditions, queryParams, paramIndex)

    let countSql = \`SELECT COUNT(*) FROM ${tableName}\`
    if (conditions.length > 0) {
      countSql += \` WHERE \${conditions.join(' AND ')}\`
    }

    const result = await client.query(countSql, queryParams)
    const count = parseInt(result.rows[0].count, 10)

    return res.status(200).json({
      success: true,
      count: count,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Error getting count:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get count',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      try {
        await client.end()
      } catch (error) {
        console.error('Error closing database client:', error)
      }
    }
  }
}
`
}
