import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateSearchEscapeHelpersCode,
  generateFilterTreeHelpersCode,
} from '../utils'
import {
  generateSortFallbackFieldHelper,
  generateSortFieldSqlHelper,
  generateSortTiebreakSql,
} from '../product-price-sort'

interface PostgreSQLConfig {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  username?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  options?: { schema?: string }
}

export const generatePostgreSQLFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const pgConfig = config as PostgreSQLConfig
  const schema = pgConfig.options?.schema

  const clientConfig = pgConfig.connectionString
    ? `{
    connectionString: ${replaceSecretReference(pgConfig.connectionString)},
  }`
    : `{
    host: ${JSON.stringify(pgConfig.host)},
    port: ${pgConfig.port || 5432},
    user: ${JSON.stringify(pgConfig.user || pgConfig.username)},
    password: ${replaceSecretReference(pgConfig.password)},
    database: ${JSON.stringify(pgConfig.database)},
    ssl: ${
      pgConfig.ssl === false
        ? 'false'
        : pgConfig.sslConfig
        ? `{
      ${pgConfig.sslConfig.ca ? `ca: ${replaceSecretReference(pgConfig.sslConfig.ca)},` : ''}
      ${pgConfig.sslConfig.cert ? `cert: ${replaceSecretReference(pgConfig.sslConfig.cert)},` : ''}
      ${pgConfig.sslConfig.key ? `key: ${replaceSecretReference(pgConfig.sslConfig.key)},` : ''}
      rejectUnauthorized: false
    }`
        : '{ rejectUnauthorized: false }'
    }
  }`

  return `import { Client } from 'pg'

const getClient = () => {
  return new Client(${clientConfig})
}

${generateSafeJSONParseCode()}

${generateFilterTreeHelpersCode()}

${generateSearchEscapeHelpersCode()}

// Builds one SQL clause for the whole filter tree, so an OR group nested in
// the root AND keeps its meaning instead of being flattened into ANDs.
const processFilters = (filters, conditions, queryParams, paramIndex) => {
  if (!filters) return paramIndex
  
  const filterTree = normalizeFilterTree(safeJSONParse(filters))
  if (!filterTree) return paramIndex
  
  const buildCondition = (condition) => {
    const field = condition.source
    const value = condition.destination
    const operand = condition.operand
    
    if (Array.isArray(value)) {
      if (value.length === 0) return null
      if (operand === 'array_overlap') {
        const clause = \`jsonb_exists_any(NULLIF(\${field}, '')::jsonb, $\${paramIndex}::text[])\`
        queryParams.push(value.map((entry) => String(entry)))
        paramIndex++
        return clause
      }
      const placeholders = value.map(() => \`$\${paramIndex++}\`)
      queryParams.push(...value)
      return operand === '!='
        ? \`\${field} NOT IN (\${placeholders.join(', ')})\`
        : \`\${field} IN (\${placeholders.join(', ')})\`
    }
    
    if (operand === 'array_overlap') {
      if (value === '' || value === null || value === undefined) return null
      // A single comma-joined string (the multi-select Category Filter's
      // ?categoryFilter=a,b,c) expands to multiple ids; one id stays one.
      const overlapValues = String(value).split(',').map((entry) => entry.trim()).filter(Boolean)
      if (overlapValues.length === 0) return null
      const clause = \`jsonb_exists_any(NULLIF(\${field}, '')::jsonb, $\${paramIndex}::text[])\`
      queryParams.push(overlapValues)
      paramIndex++
      return clause
    }
    
    if (value === null) {
      if (operand === '=') return \`\${field} IS NULL\`
      if (operand === '!=') return \`\${field} IS NOT NULL\`
      return null
    }
    
    const validOps = ['=', '!=', '>', '<', '>=', '<=']
    const sqlOperator = validOps.includes(operand) ? operand : '='
    const clause = \`\${field} \${sqlOperator} $\${paramIndex}\`
    queryParams.push(value)
    paramIndex++
    return clause
  }
  
  const clause = buildFilterTreeClause(filterTree, buildCondition)
  if (clause) conditions.push(clause)
  
  return paramIndex
}

${generateDateFormatterCode()}

${generateSortFieldSqlHelper(tableName)}

${generateSortFallbackFieldHelper(tableName)}

export default async function handler(req, res) {
  const client = getClient()
  
  try {
    await client.connect()
    ${schema ? `await client.query('SET search_path TO ${schema}')` : ''}
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    const conditions = []
    const queryParams = []
    let paramIndex = 1
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns. Wrap non-arrays so that a single
        // column passed as a bare string doesn't get iterated as chars.
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
      } else {
        // Fallback: Get all columns from information_schema
        try {
          const schemaQuery = \`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = $1
            ${schema ? `AND table_schema = $2` : ''}
            ORDER BY ordinal_position
          \`
          const schemaParams = schema 
            ? [${JSON.stringify(tableName)}, ${JSON.stringify(schema)}]
            : [${JSON.stringify(tableName)}]
          
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
          // Continue without search if we can't get columns
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

    // Apply filters using helper function
    paramIndex = processFilters(filters, conditions, queryParams, paramIndex)
    
    let sql = \`SELECT * FROM "${tableName}"\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    // Handle sorts - new array format. Two ORDER BY clauses are built: the one
    // actually used, and a plain-column twin kept only as the fallback below.
    let orderBySql = ''
    let plainOrderBySql = ''
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const valid = parsedSorts.filter((sort) => sort && sort.field)
        const orderOf = (sort) => (sort.order || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'
        const orderClauses = valid.map((sort) => \`\${sortFieldSql(sort.field)} \${orderOf(sort)}\`)
        const plainClauses = valid.map((sort) => \`\${sortFallbackField(sort.field)} \${orderOf(sort)}\`)

        if (orderClauses.length > 0) {
          // A deterministic tiebreaker keeps pagination stable: "sort by
          // discount" ties every undiscounted product at zero, and equal rows
          // with no defined order can repeat across pages or vanish between them.
          orderBySql = \` ORDER BY \${orderClauses.join(', ')}${generateSortTiebreakSql(
            tableName
          )}\`
          plainOrderBySql = \` ORDER BY \${plainClauses.join(', ')}${generateSortTiebreakSql(
            tableName
          )}\`
        }
      }
    } else if (sortBy) {
      orderBySql = \` ORDER BY \${sortBy} \${(sortOrder || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'}\`
      plainOrderBySql = orderBySql
    }
    const usedDiscountAwareSort = orderBySql !== plainOrderBySql

    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)

    let sqlTail = ''
    if (limitValue) {
      sqlTail += \` LIMIT \${limitValue}\`
    }
    
    if (offsetValue !== undefined) {
      sqlTail += \` OFFSET \${offsetValue}\`
    }

    const baseSql = sql
    sql = baseSql + orderBySql + sqlTail
    
    // The discount-aware price ordering is an inline sub-select over a JSON
    // column. It is written to be unraisable, but it runs inside ORDER BY for
    // the whole table — so if a database ever rejects it, fall back to ordering
    // by the stored list price rather than serving an empty products page.
    let result
    try {
      result = await client.query(sql, queryParams)
    } catch (sortError) {
      if (!usedDiscountAwareSort) throw sortError
      console.warn(
        'Discount-aware price sort failed; falling back to the list price:',
        sortError && sortError.message
      )
      result = await client.query(baseSql + plainOrderBySql + sqlTail, queryParams)
    }
    const rows = Array.isArray(result?.rows) ? result.rows : []
    const plainRows = rows.map((row) =>
      row && typeof row.toJSON === 'function' ? row.toJSON() : row
    )
    const safeData = JSON.parse(JSON.stringify(plainRows, dateReplacer))

    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('PostgreSQL fetch error:', error)
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
        console.error('Error closing PostgreSQL client:', error)
      }
    }
  }
}
`
}

export const generatePostgreSQLCountFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const pgConfig = config as PostgreSQLConfig
  const hasSchema = !!pgConfig.options?.schema

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
        // Use specified columns
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : [parsed]
      } else {
        // Fallback: Get all columns from information_schema
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
              ? `[${JSON.stringify(tableName)}, ${JSON.stringify(pgConfig.options!.schema)}]`
              : `[${JSON.stringify(tableName)}]`
          }
          
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
          // Continue without search if we can't get columns
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

    // Apply filters using helper function
    paramIndex = processFilters(filters, conditions, queryParams, paramIndex)

    let countSql = \`SELECT COUNT(*) FROM "${tableName}"\`
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
        console.error('Error closing PostgreSQL client:', error)
      }
    }
  }
}
`
}
