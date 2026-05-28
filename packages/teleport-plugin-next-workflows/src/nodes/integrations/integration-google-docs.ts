import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_google_docs(config: any, context: Record<string, unknown>) {
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
      const scope = config.scope || 'https://www.googleapis.com/auth/documents'
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
  const baseUrl = 'https://docs.googleapis.com/v1/documents/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-document': {
      const response = await fetch(baseUrl.replace(/\/$/, ''), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: config.title || 'Untitled Document',
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create document',
        }
      }
      return { success: true, document: data }
    }
    case 'get-document': {
      const response = await fetch(baseUrl + config.documentId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get document',
        }
      }
      return { success: true, document: data }
    }
    case 'batch-update': {
      const response = await fetch(baseUrl + config.documentId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: config.requests || [],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to batch update',
        }
      }
      return { success: true, replies: data.replies || [] }
    }
    case 'insert-text': {
      const response = await fetch(baseUrl + config.documentId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: config.index }, text: config.text } }],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to insert text',
        }
      }
      return { success: true }
    }
    case 'delete-content': {
      const response = await fetch(baseUrl + config.documentId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ requests: [{ deleteContentRange: { range: config.range } }] }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete content',
        }
      }
      return { success: true }
    }
    case 'insert-table': {
      const response = await fetch(baseUrl + config.documentId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              insertTable: {
                rows: config.rows || 3,
                columns: config.columns || 3,
                location: { index: config.index },
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to insert table',
        }
      }
      return { success: true }
    }
    case 'replace-text': {
      const response = await fetch(baseUrl + config.documentId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              replaceAllText: {
                containsText: { text: config.find, matchCase: config.matchCase || false },
                replaceText: config.replace,
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to replace text',
        }
      }
      return { success: true }
    }
    case 'insert-image': {
      const response = await fetch(baseUrl + config.documentId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              insertInlineImage: {
                uri: config.uri || config.url,
                location: { index: config.index },
                objectSize: config.objectSize || {
                  width: { magnitude: 100, unit: 'PT' },
                  height: { magnitude: 100, unit: 'PT' },
                },
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to insert image',
        }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-google-docs action: ' + action)
  }
}
export const integrationGoogleDocs: IntegrationHandlerGenerator = {
  nodeType: 'integration-google-docs',
  executionEnv: 'server',
  secretFields: ['accessToken', 'serviceAccountCredentials'],
  generateHandler(): string {
    return handlerToString(integration_google_docs)
  },
}
