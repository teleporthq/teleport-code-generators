import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_google_calendar(config: any, context: Record<string, unknown>) {
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
  // Falls back to `config.accessToken` for backwards compatibility with
  // workflows that still hold a static OAuth token.
  let accessToken = config.accessToken
  const credSource = config.serviceAccountCredentials || config.serviceAccountKey
  if (credSource) {
    try {
      const sa: any = typeof credSource === 'string' ? JSON.parse(credSource) : credSource
      const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
      const scope = config.scope || 'https://www.googleapis.com/auth/calendar'
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
      error: 'Missing credentials: provide serviceAccountCredentials (JSON) or accessToken.',
    }
  }
  const action = config.action
  const calendarId = config.calendarId || 'primary'
  const baseUrl =
    'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-event': {
      const body: Record<string, any> = {
        summary: config.summary || '',
        start: config.start || {},
        end: config.end || {},
      }
      if (config.description) {
        body.description = config.description
      }
      if (config.location) {
        body.location = config.location
      }
      if (config.attendees) {
        body.attendees = config.attendees
      }
      if (config.reminders) {
        body.reminders = config.reminders
      }
      if (config.recurrence) {
        body.recurrence = config.recurrence
      }
      if (config.timeZone) {
        body.start.timeZone = config.timeZone
        body.end.timeZone = config.timeZone
      }
      let url = baseUrl + 'events'
      if (config.sendUpdates) {
        url = url + '?sendUpdates=' + config.sendUpdates
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create event',
        }
      }
      return { success: true, event: data }
    }
    case 'list-events': {
      let url = baseUrl + 'events'
      const params = []
      if (config.timeMin) {
        params.push('timeMin=' + encodeURIComponent(config.timeMin))
      }
      if (config.timeMax) {
        params.push('timeMax=' + encodeURIComponent(config.timeMax))
      }
      if (config.maxResults) {
        params.push('maxResults=' + config.maxResults)
      }
      if (config.singleEvents !== undefined) {
        params.push('singleEvents=' + config.singleEvents)
      }
      if (config.orderBy) {
        params.push('orderBy=' + config.orderBy)
      }
      if (config.q) {
        params.push('q=' + encodeURIComponent(config.q))
      }
      if (config.pageToken) {
        params.push('pageToken=' + encodeURIComponent(config.pageToken))
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list events',
        }
      }
      return { success: true, events: data.items || [], nextPageToken: data.nextPageToken || null }
    }
    case 'get-event': {
      const response = await fetch(baseUrl + 'events/' + config.eventId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get event',
        }
      }
      return { success: true, event: data }
    }
    case 'update-event': {
      const body: Record<string, any> = {}
      if (config.summary !== undefined) {
        body.summary = config.summary
      }
      if (config.description !== undefined) {
        body.description = config.description
      }
      if (config.location !== undefined) {
        body.location = config.location
      }
      if (config.start) {
        body.start = config.start
      }
      if (config.end) {
        body.end = config.end
      }
      if (config.attendees) {
        body.attendees = config.attendees
      }
      let url = baseUrl + 'events/' + config.eventId
      if (config.sendUpdates) {
        url += '?sendUpdates=' + config.sendUpdates
      }
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update event',
        }
      }
      return { success: true, event: data }
    }
    case 'delete-event': {
      let url = baseUrl + 'events/' + config.eventId
      if (config.sendUpdates) {
        url += '?sendUpdates=' + config.sendUpdates
      }
      const response = await fetch(url, { method: 'DELETE', headers })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete event',
        }
      }
      return { success: true }
    }
    case 'quick-add': {
      const url = baseUrl + 'events/quickAdd?text=' + encodeURIComponent(config.text)
      const response = await fetch(url, { method: 'POST', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to quick add',
        }
      }
      return { success: true, event: data }
    }
    case 'get-calendar': {
      const calUrl =
        'https://www.googleapis.com/calendar/v3/calendars/' +
        encodeURIComponent(config.calendarId || calendarId)
      const response = await fetch(calUrl, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get calendar',
        }
      }
      return { success: true, calendar: data }
    }
    case 'list-calendars': {
      const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list calendars',
        }
      }
      return { success: true, calendars: data.items || [], nextPageToken: data.nextPageToken }
    }
    default:
      throw new Error('Unknown integration-google-calendar action: ' + action)
  }
}
export const integrationGoogleCalendar: IntegrationHandlerGenerator = {
  nodeType: 'integration-google-calendar',
  executionEnv: 'server',
  secretFields: ['accessToken', 'serviceAccountCredentials'],
  generateHandler(): string {
    return handlerToString(integration_google_calendar)
  },
}
