import { replaceSecretReference } from '../utils'

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

export default async function handler(req, res) {
  try {
    const client = getClient()
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const conditions = []
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      const searchConditions = columns.map(
        (col) => \`positionCaseInsensitive(toString(\${col}), '\${query}') > 0\`
      )
      conditions.push(\`(\${searchConditions.join(' OR ')})\`)
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          const formattedValues = value
            .map((v) => (typeof v === 'string' ? \`'\${v}'\` : v))
            .join(', ')
          conditions.push(\`\${key} IN (\${formattedValues})\`)
        } else if (typeof value === 'string') {
          conditions.push(\`\${key} = '\${value}'\`)
        } else {
          conditions.push(\`\${key} = \${value}\`)
        }
      })
    }
    
    let sql = \`SELECT * FROM ${tableName}\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    if (sortBy) {
      sql += \` ORDER BY \${sortBy} \${sortOrder?.toUpperCase() || 'ASC'}\`
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
    const safeData = JSON.parse(JSON.stringify(resultResponse.data))

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
