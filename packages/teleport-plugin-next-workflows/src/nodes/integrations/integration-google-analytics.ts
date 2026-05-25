import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_google_analytics(config: any, context: Record<string, unknown>) {
  // Safely parse a fetch response: providers (Dropbox, Stripe legacy errors,
  // Slack rate-limit pages, …) sometimes return plain text on failure.
  // We read once as text and only parse JSON when it actually parses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const __readJson = async (resp: any): Promise<any> => {
    const text = await resp.text()
    if (!text) {
      return {}
    }
    try {
      return JSON.parse(text)
    } catch (e: unknown) {
      void e
      return { error_summary: text, error: text, message: text, raw: text }
    }
  }
  // Mint a fresh access token from a service-account JSON when provided.
  // Falls back to `config.apiKey` for backwards compatibility with
  // workflows that still hold a static OAuth token.
  let accessToken = config.apiKey
  const credSource = config.serviceAccountCredentials || config.serviceAccountKey
  if (credSource) {
    try {
      const sa: any = typeof credSource === 'string' ? JSON.parse(credSource) : credSource
      const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
      const scope = config.scope || 'https://www.googleapis.com/auth/analytics.readonly'
      const now = Math.floor(Date.now() / 1000)
      const b64url = function (str: string) {
        return btoa(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
      }
      const enc = new TextEncoder()
      const headerB64 = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
      const claimB64 = b64url(
        JSON.stringify({
          iss: sa.client_email,
          scope,
          aud: tokenUri,
          exp: now + 3600,
          iat: now,
        })
      )
      const signingInput = headerB64 + '.' + claimB64
      const pemBody = String(sa.private_key || '')
        .replace(/-----[^-]+-----/g, '')
        .replace(/\s+/g, '')
      const binary = atob(pemBody)
      const keyBuf = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        keyBuf[i] = binary.charCodeAt(i)
      }
      const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyBuf.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sigBuf = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        cryptoKey,
        enc.encode(signingInput)
      )
      const sigBytes = new Uint8Array(sigBuf)
      let sigStr = ''
      for (let i = 0; i < sigBytes.length; i++) {
        sigStr += String.fromCharCode(sigBytes[i])
      }
      const jwt = signingInput + '.' + b64url(sigStr)
      const tokenRes = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
          encodeURIComponent(jwt),
      })
      const tokenData: any = await tokenRes.json()
      if (!tokenRes.ok || !tokenData.access_token) {
        return {
          success: false,
          error:
            'Failed to mint access token from service account: ' +
            (tokenData.error_description || tokenData.error || 'HTTP ' + tokenRes.status),
        }
      }
      accessToken = tokenData.access_token
    } catch (err: any) {
      return {
        success: false,
        error: 'Service account auth failed: ' + (err && err.message ? err.message : String(err)),
      }
    }
  }
  if (!accessToken) {
    return {
      success: false,
      error: 'Missing credentials: provide serviceAccountCredentials (JSON) or apiKey.',
    }
  }
  const action = config.action
  const baseUrl = 'https://analyticsdata.googleapis.com/v1beta/'
  const adminBaseUrl = 'https://analyticsadmin.googleapis.com/v1beta/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'run-report': {
      const body: Record<string, any> = {
        dateRanges: config.dateRanges || [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: config.metrics || [{ name: 'activeUsers' }],
        dimensions: config.dimensions || [],
      }
      if (config.dimensionFilter) {
        body.dimensionFilter = config.dimensionFilter
      }
      if (config.metricFilter) {
        body.metricFilter = config.metricFilter
      }
      if (config.orderBys) {
        body.orderBys = config.orderBys
      }
      if (config.limit) {
        body.limit = config.limit
      }
      const response = await fetch(baseUrl + 'properties/' + config.propertyId + ':runReport', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to run report',
        }
      }
      return { success: true, report: data }
    }
    case 'run-realtime-report': {
      const body: Record<string, any> = {
        metrics: config.metrics || [{ name: 'activeUsers' }],
        dimensions: config.dimensions || [],
      }
      if (config.limit) {
        body.limit = config.limit
      }
      const response = await fetch(
        baseUrl + 'properties/' + config.propertyId + ':runRealtimeReport',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to run realtime report',
        }
      }
      return { success: true, report: data }
    }
    case 'list-properties': {
      let url = adminBaseUrl + 'properties?filter=parent:accounts/' + config.accountId
      if (config.pageSize) {
        url = url + '&pageSize=' + config.pageSize
      }
      if (config.pageToken) {
        url = url + '&pageToken=' + encodeURIComponent(config.pageToken)
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list properties',
        }
      }
      return {
        success: true,
        properties: data.properties || [],
        nextPageToken: data.nextPageToken || null,
      }
    }
    case 'batch-run-reports': {
      const body = { requests: config.requests || [] }
      const response = await fetch(
        baseUrl + 'properties/' + config.propertyId + ':batchRunReports',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to batch run reports',
        }
      }
      return { success: true, reports: data }
    }
    case 'run-pivot-report': {
      const body: Record<string, any> = config.body || { dimensions: [], metrics: [] }
      const response = await fetch(
        baseUrl + 'properties/' + config.propertyId + ':runPivotReport',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to run pivot report',
        }
      }
      return { success: true, report: data }
    }
    case 'get-metadata': {
      const response = await fetch(baseUrl + 'properties/' + config.propertyId + '/metadata', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get metadata',
        }
      }
      return { success: true, metadata: data }
    }
    case 'list-accounts': {
      let url = adminBaseUrl + 'accountSummaries'
      if (config.pageSize) {
        url += '?pageSize=' + config.pageSize
      }
      if (config.pageToken) {
        url +=
          (url.indexOf('?') >= 0 ? '&' : '?') + 'pageToken=' + encodeURIComponent(config.pageToken)
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list accounts',
        }
      }
      return {
        success: true,
        accountSummaries: data.accountSummaries || [],
        nextPageToken: data.nextPageToken,
      }
    }
    case 'get-property': {
      const response = await fetch(adminBaseUrl + 'properties/' + config.propertyId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get property',
        }
      }
      return { success: true, property: data }
    }
    case 'list-audiences': {
      let url = adminBaseUrl + 'properties/' + config.propertyId + '/audiences'
      if (config.pageSize) {
        url += '?pageSize=' + config.pageSize
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list audiences',
        }
      }
      return { success: true, audiences: data.audiences || [], nextPageToken: data.nextPageToken }
    }
    case 'run-funnel-report': {
      const body = config.body || {}
      const response = await fetch(
        baseUrl + 'properties/' + config.propertyId + ':runFunnelReport',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to run funnel report',
        }
      }
      return { success: true, report: data }
    }
    case 'check-compatibility': {
      const body = config.body || {}
      const response = await fetch(
        baseUrl + 'properties/' + config.propertyId + ':checkCompatibility',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to check compatibility',
        }
      }
      return { success: true, result: data }
    }
    default:
      throw new Error('Unknown integration-google-analytics action: ' + action)
  }
}
export const integrationGoogleAnalytics: IntegrationHandlerGenerator = {
  nodeType: 'integration-google-analytics',
  executionEnv: 'server',
  secretFields: ['apiKey', 'serviceAccountKey', 'serviceAccountCredentials'],
  generateHandler(): string {
    return handlerToString(integration_google_analytics)
  },
}
