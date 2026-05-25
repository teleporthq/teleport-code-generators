import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_gmail(config: any, context: Record<string, unknown>) {
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
      const scope = config.scope || 'https://www.googleapis.com/auth/gmail.modify'
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
  const userId = config.userId || 'me'
  const baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/' + userId + '/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'send-email': {
      const to = config.to
      const subject = config.subject || ''
      const body = config.body || ''
      const cc = config.cc || ''
      const bcc = config.bcc || ''
      const rawParts = []
      rawParts.push('To: ' + to)
      if (cc) {
        rawParts.push('Cc: ' + cc)
      }
      if (bcc) {
        rawParts.push('Bcc: ' + bcc)
      }
      rawParts.push('Subject: ' + subject)
      rawParts.push('Content-Type: text/html; charset=utf-8')
      rawParts.push('')
      rawParts.push(body)
      const rawMessage = rawParts.join('\r\n')
      const encodedMessage = btoa(unescape(encodeURIComponent(rawMessage)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const response = await fetch(baseUrl + 'messages/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ raw: encodedMessage }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to send email',
        }
      }
      return { success: true, message: data }
    }
    case 'list-messages': {
      let url = baseUrl + 'messages'
      const params = []
      if (config.maxResults) {
        params.push('maxResults=' + config.maxResults)
      }
      if (config.pageToken) {
        params.push('pageToken=' + encodeURIComponent(config.pageToken))
      }
      if (config.q) {
        params.push('q=' + encodeURIComponent(config.q))
      }
      if (config.labelIds) {
        params.push('labelIds=' + encodeURIComponent(config.labelIds))
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
          error: (data.error && data.error.message) || 'Failed to list messages',
        }
      }
      return {
        success: true,
        messages: data.messages || [],
        nextPageToken: data.nextPageToken || null,
      }
    }
    case 'get-message': {
      const format = config.format || 'full'
      const response = await fetch(baseUrl + 'messages/' + config.messageId + '?format=' + format, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get message',
        }
      }
      return { success: true, message: data }
    }
    case 'search-messages': {
      let url = baseUrl + 'messages?q=' + encodeURIComponent(config.q || config.query || '')
      if (config.maxResults) {
        url += '&maxResults=' + config.maxResults
      }
      if (config.pageToken) {
        url += '&pageToken=' + encodeURIComponent(config.pageToken)
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to search' }
      }
      return { success: true, messages: data.messages || [], nextPageToken: data.nextPageToken }
    }
    case 'delete-message': {
      const response = await fetch(baseUrl + 'messages/' + config.messageId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.message) || 'Failed to delete' }
      }
      return { success: true }
    }
    case 'trash-message': {
      const response = await fetch(baseUrl + 'messages/' + config.messageId + '/trash', {
        method: 'POST',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to trash' }
      }
      return { success: true, message: data }
    }
    case 'modify-message': {
      const body: Record<string, any> = {}
      if (config.addLabelIds) {
        body.addLabelIds = config.addLabelIds
      }
      if (config.removeLabelIds) {
        body.removeLabelIds = config.removeLabelIds
      }
      const response = await fetch(baseUrl + 'messages/' + config.messageId + '/modify', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to modify' }
      }
      return { success: true, message: data }
    }
    case 'create-draft': {
      const rawParts = ['To: ' + (config.to || ''), 'Subject: ' + (config.subject || '')]
      if (config.cc) {
        rawParts.push('Cc: ' + config.cc)
      }
      rawParts.push('Content-Type: text/html; charset=utf-8', '', config.body || '')
      const encodedMessage = btoa(unescape(encodeURIComponent(rawParts.join('\r\n'))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const response = await fetch(baseUrl + 'drafts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: { raw: encodedMessage } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create draft',
        }
      }
      return { success: true, draft: data }
    }
    case 'send-draft': {
      const response = await fetch(baseUrl + 'drafts/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: config.draftId }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to send draft',
        }
      }
      return { success: true, message: data }
    }
    case 'delete-draft': {
      const response = await fetch(baseUrl + 'drafts/' + config.draftId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete draft',
        }
      }
      return { success: true }
    }
    case 'create-label': {
      const body = {
        name: config.name,
        messageListVisibility: config.messageListVisibility || 'show',
        labelListVisibility: config.labelListVisibility || 'labelShow',
      }
      const response = await fetch(baseUrl + 'labels', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create label',
        }
      }
      return { success: true, label: data }
    }
    case 'list-labels': {
      const response = await fetch(baseUrl + 'labels', { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list labels',
        }
      }
      return { success: true, labels: data.labels || [] }
    }
    default:
      throw new Error('Unknown integration-gmail action: ' + action)
  }
}
export const integrationGmail: IntegrationHandlerGenerator = {
  nodeType: 'integration-gmail',
  executionEnv: 'server',
  secretFields: ['accessToken', 'serviceAccountCredentials'],
  generateHandler(): string {
    return handlerToString(integration_gmail)
  },
}
