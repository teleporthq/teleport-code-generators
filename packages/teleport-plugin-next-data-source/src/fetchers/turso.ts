import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateFilterTreeHelpersCode,
  generateSearchEscapeHelpersCode,
} from '../utils'

export const validateTursoConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.databaseUrl || typeof config.databaseUrl !== 'string') {
    return { isValid: false, error: 'Turso database URL is required' }
  }

  if (!config.token || typeof config.token !== 'string') {
    return { isValid: false, error: 'Turso authentication token is required' }
  }

  return { isValid: true }
}

interface TursoConfig {
  url?: string
  authToken?: string
  databaseUrl?: string
  token?: string
}

export const generateTursoFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const tursoConfig = config as TursoConfig
  const databaseUrl = tursoConfig.databaseUrl
  const token = tursoConfig.token

  return `import { createClient } from '@libsql/client'

${generateSafeJSONParseCode()}

${generateFilterTreeHelpersCode()}

${generateSearchEscapeHelpersCode()}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  let client = null
  try {
    client = createClient({
      url: ${JSON.stringify(databaseUrl)},
      authToken: ${replaceSecretReference(token)}
    })
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    let sql = \`SELECT * FROM ${tableName}\`
    const whereClauses = []
    const queryParams = []
    let searchQueryColumns = null
    
    if (query) {
      if (queryColumns) {
        const parsed = safeJSONParse(queryColumns)
        const columns = Array.isArray(parsed) ? parsed : [parsed]
        // Cast columns to TEXT and LOWER both sides so the match is
        // case-insensitive regardless of SQLite collation.
        const pattern = "%" + escapeLikePattern(query) + "%"
        const searchConditions = columns.map(
          (col) =>
            'LOWER(CAST("' + sanitizeSearchIdentifier(col) + '" AS TEXT)) LIKE LOWER(?) ESCAPE ' + "'|'"
        )
        whereClauses.push("(" + searchConditions.join(" OR ") + ")")
        columns.forEach(() => {
          queryParams.push(pattern)
        })
      } else {
        // Store query for post-filtering if columns not specified
        searchQueryColumns = query
      }
    }
    
    // Helper to sanitize identifier (prevent SQL injection in column names)
    const sanitizeIdentifier = (name) => {
      // Only allow alphanumeric and underscore
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(\`Invalid identifier: \${name}\`)
      }
      return \`"\${name}"\`
    }
    
    if (filters) {
      const filterTree = normalizeFilterTree(safeJSONParse(filters))
      
      if (filterTree) {
        const buildCondition = (condition) => {
          const field = sanitizeIdentifier(condition.source)
          const value = condition.destination
          const operand = condition.operand
          
          if (Array.isArray(value)) {
            if (value.length === 0) return null
            const placeholders = value.map(() => '?').join(', ')
            queryParams.push(...value)
            return operand === '!='
              ? \`\${field} NOT IN (\${placeholders})\`
              : \`\${field} IN (\${placeholders})\`
          }
          
          if (value === null) {
            if (operand === '=') return \`\${field} IS NULL\`
            if (operand === '!=') return \`\${field} IS NOT NULL\`
            return null
          }
          
          const validOps = ['=', '!=', '>', '<', '>=', '<=']
          const sqlOperator = validOps.includes(operand) ? operand : '='
          queryParams.push(value)
          return \`\${field} \${sqlOperator} ?\`
        }
        
        const clause = buildFilterTreeClause(filterTree, buildCondition)
        if (clause) whereClauses.push(clause)
      }
    }
    
    if (whereClauses.length > 0) {
      sql += \` WHERE \${whereClauses.join(' AND ')}\`
    }
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const orderClauses = parsedSorts.map((sort) => {
          if (!sort.field) return null
          const order = (sort.order || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'
          return \`\${sanitizeIdentifier(sort.field)} \${order}\`
        }).filter(Boolean)

        if (orderClauses.length > 0) {
          sql += \` ORDER BY \${orderClauses.join(', ')}\`
        }
      }
    } else if (sortBy) {
      const sortOrderValue = (sortOrder || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'
      sql += \` ORDER BY \${sanitizeIdentifier(sortBy)} \${sortOrderValue}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    // Only apply SQL pagination if we're not doing post-filtering
    if (!searchQueryColumns) {
      if (limitValue) {
        sql += \` LIMIT ?\`
        queryParams.push(parseInt(limitValue))
      }
      
      if (offsetValue !== undefined) {
        sql += \` OFFSET ?\`
        queryParams.push(offsetValue)
      }
    }
    
    const result = await client.execute({
      sql,
      args: queryParams
    })
    
    let data = result.rows.map((row) => {
      const obj = {}
      result.columns.forEach((col, idx) => {
        obj[col] = row[col]
      })
      return obj
    })
    
    // Apply post-filtering for search without queryColumns
    if (searchQueryColumns) {
      const searchQuery = searchQueryColumns.toLowerCase()
      data = data.filter((item) => {
        try {
          const stringified = JSON.stringify(item).toLowerCase()
          return stringified.includes(searchQuery)
        } catch {
          return false
        }
      })
      
      // Apply pagination after filtering
      if (limitValue) {
        const start = offsetValue || 0
        data = data.slice(start, start + parseInt(limitValue))
      } else if (offsetValue) {
        data = data.slice(offsetValue)
      }
    }
    
    const safeData = JSON.parse(JSON.stringify(data, dateReplacer))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Turso fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      try {
        await client.close()
      } catch (error) {
        console.error('Error closing Turso client:', error)
      }
    }
  }
}
`
}
