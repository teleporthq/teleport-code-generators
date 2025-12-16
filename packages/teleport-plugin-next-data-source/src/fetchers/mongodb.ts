import { replaceSecretReference, generateDateFormatterCode } from '../utils'

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
  const hasUsername = mongoConfig?.username
  const database = mongoConfig?.database

  // Build connection string from parts if not provided
  let connectionString = mongoConfig.connectionString
  if (!connectionString) {
    connectionString = `mongodb://${
      hasUsername ? `${mongoConfig.username}:${mongoConfig.password}@` : ''
    }${mongoConfig.host}:${mongoConfig.port || 27017}/${database}`
  }

  return `import { MongoClient, ObjectId } from 'mongodb'

// Helper function to process filters
const processFilters = (filters, filter) => {
  if (!filters) return
  
  const parsedFilters = JSON.parse(filters)
  
  if (Array.isArray(parsedFilters)) {
    parsedFilters.forEach((filterItem) => {
      if (!filterItem.source || filterItem.destination === undefined) return
      
      const field = filterItem.source
      const value = filterItem.destination
      const operand = filterItem.operand || '='
      
      // Handle _id specially
      const processValue = (v) => {
        if (field === '_id' && typeof v === 'string') {
          try {
            return new ObjectId(v)
          } catch (e) {
            return v
          }
        }
        return v
      }
      
      if (Array.isArray(value)) {
        const processedValues = value.map(processValue)
        if (operand === '!=') {
          filter[field] = { $nin: processedValues }
        } else {
          filter[field] = { $in: processedValues }
        }
      } else {
        const processedValue = processValue(value)
        
        // Handle null values
        if (processedValue === null) {
          if (operand === '=') {
            filter[field] = null
          } else if (operand === '!=') {
            filter[field] = { $ne: null }
          }
        } else {
          // Map operand to MongoDB operators
          switch (operand) {
            case '=':
              filter[field] = processedValue
              break
            case '!=':
              filter[field] = { $ne: processedValue }
              break
            case '>':
              filter[field] = { $gt: processedValue }
              break
            case '>=':
              filter[field] = { $gte: processedValue }
              break
            case '<':
              filter[field] = { $lt: processedValue }
              break
            case '<=':
              filter[field] = { $lte: processedValue }
              break
            default:
              filter[field] = processedValue
          }
        }
      }
    })
  } else {
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
}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  let client = null
  try {
    const url = ${replaceSecretReference(connectionString)}
    client = new MongoClient(url, {
      connectTimeoutMS: 30000,
      serverSelectionTimeoutMS: 30000
    })
    
    await client.connect()
    const db = client.db(${JSON.stringify(database)})
    const collection = db.collection('${tableName}')
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    const filter = {}
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = JSON.parse(queryColumns)
      } else {
        // Fallback: Get all field names from a sample document
        try {
          const sampleDoc = await db.collection(${JSON.stringify(tableName)}).findOne({})
          if (sampleDoc) {
            columns = Object.keys(sampleDoc).filter(key => key !== '_id')
          }
        } catch (schemaError) {
          console.warn('Failed to fetch sample document for column names:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const orConditions = columns.map((col) => ({
          [col]: { $regex: query, $options: 'i' }
        }))
        filter.$or = orConditions
      }
    }
    
    // Apply filters using helper function
    processFilters(filters, filter)
    
    let cursor = collection.find(filter)
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = JSON.parse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const sortObject = {}
        parsedSorts.forEach((sort) => {
          if (sort.field) {
            sortObject[sort.field] = sort.order?.toLowerCase() === 'desc' ? -1 : 1
          }
        })
        if (Object.keys(sortObject).length > 0) {
          cursor = cursor.sort(sortObject)
        }
      }
    } else if (sortBy) {
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
    const safeData = JSON.parse(JSON.stringify(documents, dateReplacer))

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
      try {
        await client.close()
      } catch (error) {
        console.error('Error closing MongoDB client:', error)
      }
    }
  }
}
`
}

// tslint:disable-next-line:variable-name
export const generateMongoDBCountFetcher = (_config: any, tableName: string): string => {
  return `
async function getCount(req, res) {
  const client = getClient()
  const db = client.db()

  try {
    const { query, queryColumns, filters } = req.query
    const collection = db.collection('${tableName}')
    const filter = {}

    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
      } else {
        // Fallback: Get all field names from a sample document
        try {
          const sampleDoc = await collection.findOne({})
          if (sampleDoc) {
            columns = Object.keys(sampleDoc).filter(key => key !== '_id')
          }
        } catch (schemaError) {
          console.warn('Failed to fetch sample document for column names:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        filter.$or = columns.map(col => ({
          [col]: { $regex: query, $options: 'i' }
        }))
      }
    }

    // Apply filters using helper function
    processFilters(filters, filter)

    const count = await collection.countDocuments(filter)

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
  }
}
`
}
