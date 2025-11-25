export const validateRESTAPIConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.url || typeof config.url !== 'string' || config.url.trim() === '') {
    return { isValid: false, error: 'URL is required' }
  }

  try {
    const url = new URL(config.url)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { isValid: false, error: 'URL must use HTTP or HTTPS protocol' }
    }
  } catch {
    return { isValid: false, error: 'Invalid URL format' }
  }

  if (config.method) {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    if (typeof config.method !== 'string' || !validMethods.includes(config.method.toUpperCase())) {
      return { isValid: false, error: 'Invalid HTTP method' }
    }
  }

  return { isValid: true }
}

interface Authorization {
  type?: string
  credentials?: {
    apiKey?: string
    token?: string
    username?: string
    password?: string
    clientSecret?: string
  }
}

const generateAuthCode = (authorization: Authorization): string => {
  if (!authorization || authorization.type === 'none') {
    return ''
  }

  const { type, credentials } = authorization

  switch (type) {
    case 'api-key':
      return `headers['Authorization'] = 'ApiKey ${credentials.apiKey}'`
    case 'bearer-token':
    case 'jwt-bearer':
      return `headers['Authorization'] = 'Bearer ${credentials.token}'`
    case 'basic-auth':
      return `headers['Authorization'] = 'Basic ' + Buffer.from('${credentials.username}:${credentials.password}').toString('base64')`
    case 'oauth2':
      return `headers['Authorization'] = 'Bearer ${credentials.clientSecret}'`
    default:
      return ''
  }
}

interface RESTAPIConfig {
  url: string
  method?: string
  headers?: Record<string, string>
  authorization?: Authorization
  bodyType?: string
}

export const generateRESTAPIFetcher = (config: Record<string, unknown>): string => {
  const restConfig = config as RESTAPIConfig
  const authCode = generateAuthCode(restConfig.authorization || {})

  return `import fetch from 'node-fetch'

export default async function handler(req, res) {
  try {
    const { offset, limit } = req.query
    
    const url = ${JSON.stringify(restConfig.url)}
    const method = ${JSON.stringify(restConfig.method || 'GET')}
    
    const headers = ${JSON.stringify(restConfig.headers || {})}
    ${authCode}
    
    const options = {
      method,
      headers
    }
    
    ${
      restConfig.method === 'POST' || restConfig.method === 'PUT' || restConfig.method === 'PATCH'
        ? `
    if (req.body) {
      options.body = ${
        restConfig.bodyType === 'json' || !restConfig.bodyType
          ? 'JSON.stringify(req.body)'
          : 'req.body'
      }
    }
    `
        : ''
    }
    
    const response = await fetch(url, options)
    
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: \`HTTP \${response.status}: \${response.statusText}\`,
        timestamp: Date.now()
      })
    }
    
    let data = await response.json()
    
    // Apply offset and limit if data is an array and parameters are provided
    if (Array.isArray(data)) {
      const offsetValue = offset !== undefined ? parseInt(offset) : 0
      const limitValue = limit !== undefined ? parseInt(limit) : undefined
      
      if (limitValue !== undefined) {
        data = data.slice(offsetValue, offsetValue + limitValue)
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
    console.error('REST API fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
