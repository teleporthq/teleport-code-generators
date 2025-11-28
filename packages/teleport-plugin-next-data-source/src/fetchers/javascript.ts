export const validateJavaScriptConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.code || typeof config.code !== 'string' || config.code.trim() === '') {
    return { isValid: false, error: 'JavaScript code is required' }
  }

  const dangerousPatterns = [
    /require\s*\(/i,
    /import\s+/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /process\./i,
    /global\./i,
    /\.exec\s*\(/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(config.code)) {
      console.warn('[Data Source] Warning: JavaScript code contains potentially dangerous patterns')
      break
    }
  }

  return { isValid: true }
}

interface JavaScriptConfig {
  code?: string
}

export const generateJavaScriptFetcher = (config: Record<string, unknown>): string => {
  const jsConfig = config as JavaScriptConfig
  return `export default async function handler(req, res) {
  try {
    const { limit, offset, page, perPage, query, queryColumns } = req.query
    
    const code = ${JSON.stringify(jsConfig.code)}
    const executeCode = new Function('return ' + code)
    let data = executeCode()
    
    if (Array.isArray(data)) {
      if (query) {
        const searchQuery = query.toLowerCase()
        
        if (queryColumns) {
          // Search specific columns
          const columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
          data = data.filter(item => {
            return columns.some(col => {
              const value = item[col]
              if (value === null || value === undefined) return false
              return String(value).toLowerCase().includes(searchQuery)
            })
          })
        } else {
          // Search across all fields by stringifying the entire record
          data = data.filter(item => {
            try {
              const stringified = JSON.stringify(item).toLowerCase()
              return stringified.includes(searchQuery)
            } catch {
              return false
            }
          })
        }
      }
      
      const limitValue = limit || perPage
      const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : 0)
      
      if (limitValue) {
        data = data.slice(offsetValue, offsetValue + parseInt(limitValue))
      } else if (offsetValue > 0) {
        data = data.slice(offsetValue)
      }
    }
    
    const safeData = JSON.parse(JSON.stringify(data))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('JavaScript execution error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute code',
      timestamp: Date.now()
    })
  }
}
`
}

export const generateJavaScriptCountFetcher = (config: any): string => {
  return `
async function getCount(req, res) {
  try {
    const { query, queryColumns } = req.query
    const fakeReq = { query: { query, queryColumns }, method: 'GET' }
    let result = null
    let statusCode = 200
    
    const fakeRes = {
      status: (code) => {
        statusCode = code
        return fakeRes
      },
      json: (data) => {
        result = data
        return fakeRes
      },
    }
    
    await handler(fakeReq, fakeRes)
    
    if (statusCode !== 200 || !result || !result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get data for counting',
        timestamp: Date.now()
      })
    }
    
    const count = Array.isArray(result.data) ? result.data.length : 0
    
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
