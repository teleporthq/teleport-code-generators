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
    const { limit, offset, page, perPage } = req.query
    
    const code = ${JSON.stringify(jsConfig.code)}
    const executeCode = new Function('return ' + code)
    let data = executeCode()
    
    // Apply pagination if data is an array
    if (Array.isArray(data)) {
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
