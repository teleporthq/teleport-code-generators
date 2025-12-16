import { replaceSecretReference, generateDateFormatterCode } from '../utils'

export const validateClickHouseConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.url || typeof config.url !== 'string') {
    return { isValid: false, error: 'ClickHouse URL is required' }
  }

  if (!config.username || typeof config.username !== 'string') {
    return { isValid: false, error: 'ClickHouse username is required' }
  }

  if (!config.password || typeof config.password !== 'string') {
    return { isValid: false, error: 'ClickHouse password is required' }
  }

  return { isValid: true }
}

interface ClickHouseConfig {
  url?: string
  username?: string
  password?: string
}

export const generateClickHouseFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const clickConfig = config as ClickHouseConfig
  const url = clickConfig.url
  const username = clickConfig.username
  const password = clickConfig.password

  return `import { createClient } from '@clickhouse/client'

let client = null

const getClient = () => {
  if (client) return client
  
  client = createClient({
    url: ${JSON.stringify(url)},
    username: ${JSON.stringify(username)},
    password: ${replaceSecretReference(password)}
  })
  
  return client
}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  try {
    const client = getClient()
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    const conditions = []
    
    if (query) {
      if (queryColumns) {
        const columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
        const searchConditions = columns.map(
          (col) => \`positionCaseInsensitive(toString(\${col}), '\${query}') > 0\`
        )
        conditions.push(\`(\${searchConditions.join(' OR ')})\`)
      } else {
        // Note: Without queryColumns, ClickHouse can't search all columns efficiently
        // Users should provide queryColumns for optimal search performance
        console.warn('Search query provided without queryColumns - search may not work as expected')
      }
    }
    
    const formatClickHouseValue = (value) => {
      if (value === null || value === undefined) return 'NULL'
      if (typeof value === 'string') return \`'\${value.replace(/'/g, "\\\\'")}'\`
      if (typeof value === 'boolean') return value ? '1' : '0'
      return String(value)
    }
    
    // Helper to sanitize identifier (prevent SQL injection in column names)
    const sanitizeIdentifier = (name) => {
      // Only allow alphanumeric and underscore
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(\`Invalid identifier: \${name}\`)
      }
      return \`\\\`\${name}\\\`\`
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      
      if (Array.isArray(parsedFilters)) {
        parsedFilters.forEach((filter) => {
          if (!filter.source || filter.destination === undefined) return
          
          const field = sanitizeIdentifier(filter.source)
          const value = filter.destination
          const operand = filter.operand || '='
          
          if (Array.isArray(value)) {
            if (value.length === 0) return
            const formattedValues = value.map(formatClickHouseValue).join(', ')
            if (operand === '!=') {
              conditions.push(\`\${field} NOT IN (\${formattedValues})\`)
            } else {
              conditions.push(\`\${field} IN (\${formattedValues})\`)
            }
          } else {
            if (value === null) {
              if (operand === '=') {
                conditions.push(\`\${field} IS NULL\`)
              } else if (operand === '!=') {
                conditions.push(\`\${field} IS NOT NULL\`)
              }
            } else {
              const validOps = ['=', '!=', '>', '<', '>=', '<=']
              const sqlOperator = validOps.includes(operand) ? operand : '='
              conditions.push(\`\${field} \${sqlOperator} \${formatClickHouseValue(value)}\`)
            }
          }
        })
      } else {
        Object.entries(parsedFilters).forEach(([key, value]) => {
          const field = sanitizeIdentifier(key)
          if (Array.isArray(value)) {
            const formattedValues = value.map(formatClickHouseValue).join(', ')
            conditions.push(\`\${field} IN (\${formattedValues})\`)
          } else {
            conditions.push(\`\${field} = \${formatClickHouseValue(value)}\`)
          }
        })
      }
    }
    
    let sql = \`SELECT * FROM ${tableName}\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = JSON.parse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const orderClauses = parsedSorts.map((sort) => {
          if (!sort.field) return null
          const order = sort.order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
          return \`\${sanitizeIdentifier(sort.field)} \${order}\`
        }).filter(Boolean)
        
        if (orderClauses.length > 0) {
          sql += \` ORDER BY \${orderClauses.join(', ')}\`
        }
      }
    } else if (sortBy) {
      sql += \` ORDER BY \${sanitizeIdentifier(sortBy)} \${sortOrder?.toUpperCase() || 'ASC'}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (limitValue) {
      sql += \` LIMIT \${limitValue}\`
    }
    
    if (offsetValue !== undefined) {
      sql += \` OFFSET \${offsetValue}\`
    }
    
    const result = await client.query({ query: sql })
    const resultResponse = await result.json()
    const safeData = JSON.parse(JSON.stringify(resultResponse.data, dateReplacer))

    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('ClickHouse fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
