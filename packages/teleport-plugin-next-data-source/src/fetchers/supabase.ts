import { replaceSecretReference } from '../utils'

export const validateSupabaseConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.supabaseUrl || typeof config.supabaseUrl !== 'string') {
    return { isValid: false, error: 'Supabase URL is required' }
  }

  try {
    const url = new URL(config.supabaseUrl)
    if (!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.in')) {
      console.warn('[Data Source] Warning: Supabase URL does not match expected format')
    }
  } catch {
    return { isValid: false, error: 'Invalid Supabase URL format' }
  }

  if (!config.serviceRoleKey && !config.publicApiKey) {
    return {
      isValid: false,
      error: 'Supabase API key (serviceRoleKey or publicApiKey) is required',
    }
  }

  return { isValid: true }
}

interface SupabaseConfig {
  url?: string
  anonKey?: string
  supabaseUrl?: string
  serviceRoleKey?: string
  publicApiKey?: string
}

export const generateSupabaseFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const supabaseConfig = config as SupabaseConfig
  const supabaseUrl = supabaseConfig.supabaseUrl
  const apiKey = supabaseConfig.serviceRoleKey || supabaseConfig.publicApiKey

  return `import { createClient } from '@supabase/supabase-js'

let client = null

const getClient = () => {
  if (client) return client
  
  client = createClient(
    ${JSON.stringify(supabaseUrl)},
    ${replaceSecretReference(apiKey)}
  )
  
  return client
}

export default async function handler(req, res) {
  try {
    const client = getClient()
    const { query, queryColumns, select, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    let queryRef = client.from('${tableName}').select(select || '*')
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = JSON.parse(queryColumns)
      } else {
        // Fallback: Get all column names from a sample row
        try {
          const { data: sampleData, error: sampleError } = await client.from('${tableName}').select('*').limit(1).single()
          if (sampleError) {
            throw sampleError
          }
          if (sampleData) {
            columns = Object.keys(sampleData)
          }
        } catch (schemaError) {
          console.warn('Failed to fetch sample row for column names:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const searchPattern = \`%\${query}%\`
        const orConditions = columns.map((col) => \`\${col}.ilike.\${searchPattern}\`).join(',')
        queryRef = queryRef.or(orConditions)
      }
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          const processedValues = value.map((v) => {
            if (typeof v === 'string' && !isNaN(Number(v))) {
              return Number(v)
            }
            return v
          })
          queryRef = queryRef.in(key, processedValues)
        } else if (typeof value === 'object' && value !== null) {
          const operator = Object.keys(value)[0]
          let operatorValue = value[operator]
          if (typeof operatorValue === 'string' && !isNaN(Number(operatorValue))) {
            operatorValue = Number(operatorValue)
          }
          switch (operator) {
            case 'eq': queryRef = queryRef.eq(key, operatorValue); break
            case 'neq': queryRef = queryRef.neq(key, operatorValue); break
            case 'gt': queryRef = queryRef.gt(key, operatorValue); break
            case 'gte': queryRef = queryRef.gte(key, operatorValue); break
            case 'lt': queryRef = queryRef.lt(key, operatorValue); break
            case 'lte': queryRef = queryRef.lte(key, operatorValue); break
            case 'like': queryRef = queryRef.like(key, operatorValue); break
            case 'ilike': queryRef = queryRef.ilike(key, operatorValue); break
            case 'in': queryRef = queryRef.in(key, operatorValue); break
            default: queryRef = queryRef.eq(key, operatorValue)
          }
        } else {
          let processedValue = value
          if (typeof value === 'string' && !isNaN(Number(value))) {
            processedValue = Number(value)
          }
          queryRef = queryRef.eq(key, processedValue)
        }
      })
    }
    
    if (sortBy) {
      queryRef = queryRef.order(sortBy, { ascending: sortOrder !== 'desc' })
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (offsetValue !== undefined && limitValue) {
      queryRef = queryRef.range(offsetValue, offsetValue + parseInt(limitValue) - 1)
    } else if (limitValue) {
      queryRef = queryRef.limit(parseInt(limitValue))
    }
    
    const { data, error } = await queryRef
    
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        timestamp: Date.now()
      })
    }
    
    const safeData = JSON.parse(JSON.stringify(data))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Supabase fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}

export const generateSupabaseCountFetcher = (config: any, tableName: string): string => {
  return `
async function getCount(req, res) {
  const supabase = getClient()

  try {
    const { query, queryColumns, filters } = req.query
    let countQuery = supabase.from('${tableName}').select('*', { count: 'exact', head: true })

    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
      } else {
        // Fallback: Get all column names from a sample row
        try {
          const { data: sampleData, error: sampleError } = await supabase.from('${tableName}').select('*').limit(1).single()
          if (sampleError) {
            throw sampleError
          }
          if (sampleData) {
            columns = Object.keys(sampleData)
          }
        } catch (schemaError) {
          console.warn('Failed to fetch sample row for column names:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const searchPattern = \`%\${query}%\`
        const orConditions = columns.map((col) => \`\${col}.ilike.\${searchPattern}\`).join(',')
        countQuery = countQuery.or(orConditions)
      }
    }

    if (filters) {
      const parsedFilters = JSON.parse(filters)
      for (const filter of parsedFilters) {
        countQuery = countQuery.eq(filter.column, filter.value)
      }
    }

    const { count, error } = await countQuery
    
    if (error) throw error

    return res.status(200).json({
      success: true,
      count: count || 0,
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
