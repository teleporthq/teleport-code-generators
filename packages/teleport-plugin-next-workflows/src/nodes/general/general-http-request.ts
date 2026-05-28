import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_http_request(config: any, context: Record<string, unknown>) {
  const url = config.url
  const method = (config.method || 'GET').toUpperCase()
  const headers = config.headers || []
  const queryParams = config.queryParams || []
  const body = config.body
  const bodyType = config.bodyType || 'json'
  const timeout = config.timeout || 30000

  try {
    const parsedUrl = new URL(url)
    for (let i = 0; i < queryParams.length; i++) {
      if (queryParams[i].key) {
        parsedUrl.searchParams.append(queryParams[i].key, queryParams[i].value || '')
      }
    }

    const fetchHeaders: Record<string, string> = {}
    for (let h = 0; h < headers.length; h++) {
      if (headers[h].key) {
        fetchHeaders[headers[h].key] = headers[h].value || ''
      }
    }

    const fetchOptions: Record<string, any> = {
      method,
      headers: fetchHeaders,
    }

    if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
      if (bodyType === 'json') {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json'
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body)
      } else if (bodyType === 'form-data') {
        const formData = new FormData()
        if (typeof body === 'object' && body !== null) {
          const keys = Object.keys(body)
          for (let f = 0; f < keys.length; f++) {
            formData.append(keys[f], body[keys[f]])
          }
        }
        fetchOptions.body = formData
      } else if (bodyType === 'x-www-form-urlencoded') {
        fetchHeaders['Content-Type'] =
          fetchHeaders['Content-Type'] || 'application/x-www-form-urlencoded'
        if (typeof body === 'object' && body !== null) {
          const params = new URLSearchParams()
          const bKeys = Object.keys(body)
          for (let u = 0; u < bKeys.length; u++) {
            params.append(bKeys[u], body[bKeys[u]])
          }
          fetchOptions.body = params.toString()
        } else {
          fetchOptions.body = String(body)
        }
      } else if (bodyType === 'raw') {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'text/plain'
        fetchOptions.body = String(body)
      } else if (bodyType === 'binary') {
        fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/octet-stream'
        fetchOptions.body = body
      } else {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body)
      }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    if (controller) {
      fetchOptions.signal = controller.signal
      timeoutId = setTimeout(function () {
        controller.abort()
      }, timeout)
    }

    const response = await fetch(parsedUrl.toString(), fetchOptions)

    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    const responseHeaders = {}
    response.headers.forEach(function (value, key) {
      responseHeaders[key] = value
    })

    const contentType = response.headers.get('content-type') || ''
    let responseBody: any
    if (contentType.indexOf('application/json') !== -1) {
      try {
        responseBody = await response.json()
      } catch (e) {
        responseBody = await response.text()
      }
    } else {
      responseBody = await response.text()
    }

    // The output shape MUST match the general-http-request schema in
    // packages/workflow-schema/src/types/node-context-schemas.json. The GUI
    // exposes "body" as the bindable field, so downstream nodes look up
    // <httpNode>.body. Returning "data" here breaks every workflow that
    // chains a loop / transform off the HTTP response, silently iterating
    // an empty array because "body" is undefined.
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
    }
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      return {
        status: 0,
        statusText: 'Request Timeout',
        headers: {},
        body: null,
        error: 'Request timed out after ' + timeout + 'ms',
      }
    }
    return {
      status: 0,
      statusText: 'Network Error',
      headers: {},
      body: null,
      error: (err as Error).message,
    }
  }
}
export const generalHttpRequest: NodeHandlerGenerator = {
  nodeType: 'general-http-request',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(general_http_request)
  },
}
