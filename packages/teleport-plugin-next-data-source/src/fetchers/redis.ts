import { replaceSecretReference } from '../utils'

export const validateRedisConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  // If connectionString is provided, validate it
  if (config.connectionString) {
    if (typeof config.connectionString !== 'string' || config.connectionString.trim() === '') {
      return { isValid: false, error: 'Connection string must be a non-empty string' }
    }

    // Only validate format if it's not a secret reference that will be resolved at runtime
    const connStr = config.connectionString as string
    if (
      !connStr.startsWith('teleporthq.secrets.') &&
      !connStr.startsWith('redis://') &&
      !connStr.startsWith('rediss://')
    ) {
      return { isValid: false, error: 'Invalid Redis connection string format' }
    }

    return { isValid: true }
  }

  // If no connectionString, host/port/etc will be used to build one
  if (!config.host || typeof config.host !== 'string') {
    return { isValid: false, error: 'Redis host is required when connectionString is not provided' }
  }

  return { isValid: true }
}

interface RedisConfig {
  connectionString?: string
  host?: string
  port?: number
  database?: number
  password?: string
  username?: string
  selectedTables?: Record<string, unknown>
}

export const generateRedisFetcher = (
  config: Record<string, unknown>,
  tableName?: string
): string => {
  const redisConfig = config as RedisConfig
  const hasUsername = redisConfig.username

  // Build connection string from parts if not provided
  let connectionString = redisConfig.connectionString
  if (!connectionString) {
    connectionString = `redis://${
      hasUsername ? `${redisConfig.username}:${redisConfig.password}@` : ''
    }${redisConfig.host}:${redisConfig.port || 6379}`
  }

  return `import { createClient } from 'redis'

export default async function handler(req, res) {
  let client = null
  try {
    client = createClient({
      url: ${replaceSecretReference(connectionString)}${
    redisConfig.database ? `,\n      database: ${redisConfig.database}` : ''
  }
    })
    
    await client.connect()
    
    const { query, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const pattern = (filters && JSON.parse(filters).pattern) || query || '*'
    const keys = await client.keys(pattern)
    
    const limitValue = limit || perPage || 100
    const skipValue = offset !== undefined ? parseInt(offset) : ((parseInt(page) || 1) - 1) * parseInt(limitValue)
    const paginatedKeys = keys.slice(skipValue, skipValue + parseInt(limitValue))
    
    const results = []
    for (const key of paginatedKeys) {
      const type = await client.type(key)
      const ttl = await client.ttl(key)
      let value
      
      switch (type) {
        case 'string':
          value = await client.get(key)
          break
        case 'list':
          value = await client.lRange(key, 0, -1)
          break
        case 'set':
          value = await client.sMembers(key)
          break
        case 'zset':
          value = await client.zRange(key, 0, -1)
          break
        case 'hash':
          value = await client.hGetAll(key)
          break
        default:
          value = null
      }
      
      results.push({
        key,
        type,
        value,
        ttl: ttl === -1 ? null : ttl
      })
    }
    
    if (sortBy) {
      const sortOrderValue = sortOrder?.toLowerCase() === 'desc' ? -1 : 1
      results.sort((a, b) => {
        const aVal = a[sortBy]
        const bVal = b[sortBy]
        if (aVal < bVal) return -sortOrderValue
        if (aVal > bVal) return sortOrderValue
        return 0
      })
    }
    
    const safeData = JSON.parse(JSON.stringify(results))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Redis fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      await client.quit()
    }
  }
}
`
}
