import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateSearchEscapeHelpersCode,
} from '../utils'

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
  /*
DO $$
DECLARE
    first_account_id UUID;
    first_team_id UUID;
BEGIN
    -- Step 1: Select the first account's id
    SELECT id INTO first_account_id
    FROM accounts
    ORDER BY id
    LIMIT 1;

    -- Step 2: Insert into subscriptions
    INSERT INTO subscriptions (
        "stripeSubscriptionId",
        "accountId",
        "stripeCurrentPeriodStart",
        "stripeCurrentPeriodEnd",
        "createdAt",
        "updatedAt",
        "percentOff"
    ) VALUES (
        'abc',
        first_account_id,
        '2025-08-13 00:00:00+00'::timestamptz,
        '2035-09-13 00:00:00+00'::timestamptz,
        '2025-08-13 00:00:00+00'::timestamptz,
        '2025-08-13 00:00:00+00'::timestamptz,
        100
    );

    -- Step 3: Insert into subscription-items
    INSERT INTO "subscription-items" (
        "stripeSubscriptionItemId",
        "stripePriceId",
        "stripeSubscriptionId",
        "createdAt",
        "updatedAt"
    ) VALUES (
        'abc',
        'price_1KO3BuGd5V11xo4EFF8fKiVR',
        'abc',
        '2025-08-13 00:00:00+00'::timestamptz,
        '2025-08-13 00:00:00+00'::timestamptz
    );

    -- Step 4: Get first team id and update its subscriptionItemId
    SELECT id INTO first_team_id
    FROM teams
    ORDER BY id
    LIMIT 1;

    UPDATE teams
    SET "subscriptionItemId" = 'abc'
    WHERE id = first_team_id;

    RAISE NOTICE 'Script completed successfully. Account ID: %, Team ID: %', first_account_id, first_team_id;
END $$;

*/
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

${generateSafeJSONParseCode()}

${generateSearchEscapeHelpersCode()}

// Helper function to process filter values
const processFilterValue = (value) => {
  if (typeof value === 'string' && !isNaN(Number(value))) {
    return Number(value)
  }
  return value
}

// Helper function to apply filters to a query
const applyFilters = (queryRef, filters) => {
  if (!filters) return queryRef
  
  const parsedFilters = safeJSONParse(filters)
  
  if (Array.isArray(parsedFilters)) {
    parsedFilters.forEach((filter) => {
      if (!filter.source || filter.destination === undefined) return
      
      const field = filter.source
      const value = filter.destination
      const operand = filter.operand || '='
      
      if (Array.isArray(value)) {
        const processedValues = value.map(processFilterValue)
        if (operand === '!=') {
          queryRef = queryRef.not(field, 'in', processedValues)
        } else {
          queryRef = queryRef.in(field, processedValues)
        }
      } else {
        const processedValue = processFilterValue(value)
        
        // Handle null values
        if (processedValue === null) {
          if (operand === '=') {
            queryRef = queryRef.is(field, null)
          } else if (operand === '!=') {
            queryRef = queryRef.not(field, 'is', null)
          }
        } else {
          // Map operand to Supabase methods
          switch (operand) {
            case '=':
              queryRef = queryRef.eq(field, processedValue)
              break
            case '!=':
              queryRef = queryRef.neq(field, processedValue)
              break
            case '>':
              queryRef = queryRef.gt(field, processedValue)
              break
            case '>=':
              queryRef = queryRef.gte(field, processedValue)
              break
            case '<':
              queryRef = queryRef.lt(field, processedValue)
              break
            case '<=':
              queryRef = queryRef.lte(field, processedValue)
              break
            default:
              queryRef = queryRef.eq(field, processedValue)
          }
        }
      }
    })
  } else {
    // Old format: object with key-value pairs (backward compatibility)
    Object.entries(parsedFilters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        const processedValues = value.map(processFilterValue)
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
  
  return queryRef
}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  try {
    const client = getClient()
    const { query, queryColumns, select, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    let queryRef = client.from('${tableName}').select(select || '*')
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns. Wrap non-arrays so a single column
        // passed as a bare string doesn't get iterated as chars.
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
      } else {
        // Fallback: Get text-searchable columns from a sample row
        try {
          const { data: sampleData, error: sampleError } = await client.from('${tableName}').select('*').limit(1).single()
          if (sampleError) {
            throw sampleError
          }
          if (sampleData) {
            // Filter out columns that are likely non-text types
            // Note: This is heuristic-based since we don't have schema info
            columns = Object.keys(sampleData).filter(col => {
              const value = sampleData[col]
              const colLower = col.toLowerCase()
              
              // Exclude common timestamp/date column names
              if (colLower.includes('_at') || colLower.includes('date') || colLower === 'timestamp') {
                return false
              }
              
              // Exclude if value is a number, boolean, null, or object (non-string)
              if (value === null || value === undefined) {
                return true // Include null columns, let the query handle it
              }
              
              const type = typeof value
              return type === 'string' // Only include string values
            })
          }
        } catch (schemaError) {
          console.warn('Failed to fetch sample row for column names:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        // PostgREST .or() DSL separates conditions with comma and uses
        // dot to split field / operator / value, so we wrap the pattern
        // in double quotes and backslash-escape any embedded quotes or
        // backslashes in the user's search term. Columns go through the
        // shared identifier sanitizer to reject injection. Note:
        // PostgREST .ilike. does not expose a LIKE ESCAPE clause, so
        // raw % / _ in the user input still act as wildcards in this
        // backend; the canvas preview path escapes them explicitly.
        const rawPattern = "%" + String(query) + "%"
        const escapedForPostgrest = rawPattern
          .replace(/\\\\/g, "\\\\\\\\")
          .replace(/"/g, '\\\\"')
        const searchPattern = '"' + escapedForPostgrest + '"'
        const orConditions = columns
          .map((col) => sanitizeSearchIdentifier(col) + ".ilike." + searchPattern)
          .join(",")
        queryRef = queryRef.or(orConditions)
      }
    }

    // Apply filters using helper function
    queryRef = applyFilters(queryRef, filters)
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts)) {
        parsedSorts.forEach((sort) => {
          if (sort.field) {
            queryRef = queryRef.order(sort.field, {
              ascending: !(sort.order || '').toLowerCase().startsWith('desc')
            })
          }
        })
      }
    } else if (sortBy) {
      queryRef = queryRef.order(sortBy, { ascending: !(sortOrder || '').toLowerCase().startsWith('desc') })
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
    
    const safeData = JSON.parse(JSON.stringify(data, dateReplacer))
    
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

// tslint:disable-next-line:variable-name
export const generateSupabaseCountFetcher = (_config: any, tableName: string): string => {
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
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : [parsed]
      } else {
        // Fallback: Get text-searchable columns from a sample row
        try {
          const { data: sampleData, error: sampleError } = await supabase.from('${tableName}').select('*').limit(1).single()
          if (sampleError) {
            throw sampleError
          }
          if (sampleData) {
            // Filter out columns that are likely non-text types
            // Note: This is heuristic-based since we don't have schema info
            columns = Object.keys(sampleData).filter(col => {
              const value = sampleData[col]
              const colLower = col.toLowerCase()
              
              // Exclude common timestamp/date column names
              if (colLower.includes('_at') || colLower.includes('date') || colLower === 'timestamp') {
                return false
              }
              
              // Exclude if value is a number, boolean, null, or object (non-string)
              if (value === null || value === undefined) {
                return true // Include null columns, let the query handle it
              }
              
              const type = typeof value
              return type === 'string' // Only include string values
            })
          }
        } catch (schemaError) {
          console.warn('Failed to fetch sample row for column names:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        // Mirror the fetch handler: sanitize identifiers, wrap the
        // pattern in double quotes for PostgREST .or() DSL, and escape
        // backslashes / quotes in the user's search term.
        const rawPattern = "%" + String(query) + "%"
        const escapedForPostgrest = rawPattern
          .replace(/\\\\/g, "\\\\\\\\")
          .replace(/"/g, '\\\\"')
        const searchPattern = '"' + escapedForPostgrest + '"'
        const orConditions = columns
          .map((col) => sanitizeSearchIdentifier(col) + ".ilike." + searchPattern)
          .join(",")
        countQuery = countQuery.or(orConditions)
      }
    }

    // Apply filters using helper function
    countQuery = applyFilters(countQuery, filters)

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
