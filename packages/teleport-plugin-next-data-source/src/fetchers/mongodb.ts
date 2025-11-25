import { replaceSecretReference } from '../utils'

export const validateMongoDBConfig = (
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
      !connStr.startsWith('mongodb://') &&
      !connStr.startsWith('mongodb+srv://')
    ) {
      return { isValid: false, error: 'Invalid MongoDB connection string format' }
    }

    return { isValid: true }
  }

  // If no connectionString, host/port/database/etc will be used to build one
  // Make host optional - if neither connectionString nor host is provided,
  // the generator will need to handle it
  if (config.host !== undefined && typeof config.host !== 'string') {
    return { isValid: false, error: 'Host must be a string' }
  }

  if (!config.database || typeof config.database !== 'string') {
    return { isValid: false, error: 'Database name is required' }
  }

  return { isValid: true }
}

interface MongoDBConfig {
  connectionString?: string
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
}

export const generateMongoDBFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const mongoConfig = config as MongoDBConfig
  const hasUsername = mongoConfig.username

  // Build connection string from parts if not provided
  let connectionString = mongoConfig.connectionString
  if (!connectionString) {
    connectionString = `mongodb://${
      hasUsername ? `${mongoConfig.username}:${mongoConfig.password}@` : ''
    }${mongoConfig.host}:${mongoConfig.port || 27017}/${mongoConfig.database}`
  }

  return `import { MongoClient, ObjectId } from 'mongodb'

export default async function handler(req, res) {
  let client = null
  try {
    const url = ${replaceSecretReference(connectionString)}
    client = new MongoClient(url, {
      connectTimeoutMS: 30000,
      serverSelectionTimeoutMS: 30000
    })
    
    await client.connect()
    const db = client.db(${JSON.stringify(mongoConfig.database)})
    const collection = db.collection('${tableName}')
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const filter = {}
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      const orConditions = columns.map((col) => ({
        [col]: { $regex: query, $options: 'i' }
      }))
      filter.$or = orConditions
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (key === '_id') {
          if (Array.isArray(value)) {
            filter[key] = {
              $in: value.map((id) => (typeof id === 'string' ? new ObjectId(id) : id))
            }
          } else if (typeof value === 'string') {
            filter[key] = new ObjectId(value)
          } else {
            filter[key] = value
          }
        } else if (Array.isArray(value)) {
          filter[key] = { $in: value }
        } else {
          filter[key] = value
        }
      })
    }
    
    let cursor = collection.find(filter)
    
    if (sortBy) {
      const sortOrderValue = sortOrder?.toLowerCase() === 'desc' ? -1 : 1
      cursor = cursor.sort({ [sortBy]: sortOrderValue })
    }
    
    const limitValue = limit || perPage
    const skipValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (skipValue !== undefined) {
      cursor = cursor.skip(skipValue)
    }
    
    if (limitValue) {
      cursor = cursor.limit(parseInt(limitValue))
    }
    
    const documents = await cursor.toArray()
    const safeData = JSON.parse(JSON.stringify(documents))

    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('MongoDB fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      await client.close()
    }
  }
}
`
}
