import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_google_drive(config: any, context: Record<string, unknown>) {
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
  if (config.serviceAccountCredentials) {
    try {
      const sa: any =
        typeof config.serviceAccountCredentials === 'string'
          ? JSON.parse(config.serviceAccountCredentials)
          : config.serviceAccountCredentials
      const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
      const scope = config.scope || 'https://www.googleapis.com/auth/drive'
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
      error: 'Missing credentials: provide either serviceAccountCredentials (JSON) or accessToken.',
    }
  }
  const action = config.action
  const baseUrl = 'https://www.googleapis.com/drive/v3/'
  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'list-files': {
      let url = baseUrl + 'files'
      const params = []
      if (config.q) {
        params.push('q=' + encodeURIComponent(config.q))
      }
      if (config.pageSize) {
        params.push('pageSize=' + config.pageSize)
      }
      if (config.pageToken) {
        params.push('pageToken=' + encodeURIComponent(config.pageToken))
      }
      if (config.orderBy) {
        params.push('orderBy=' + encodeURIComponent(config.orderBy))
      }
      if (config.fields) {
        params.push('fields=' + encodeURIComponent(config.fields))
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
          error: (data.error && data.error.message) || 'Failed to list files',
        }
      }
      return { success: true, files: data.files || [], nextPageToken: data.nextPageToken || null }
    }
    case 'get-file': {
      const fields = config.fields || 'id,name,mimeType,size,createdTime,modifiedTime'
      const response = await fetch(
        baseUrl + 'files/' + config.fileId + '?fields=' + encodeURIComponent(fields),
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to get file' }
      }
      return { success: true, file: data }
    }
    case 'create-folder': {
      const body: Record<string, any> = {
        name: config.name || 'New Folder',
        mimeType: 'application/vnd.google-apps.folder',
      }
      if (config.parents) {
        body.parents = config.parents
      }
      const response = await fetch(baseUrl + 'files', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create folder',
        }
      }
      return { success: true, folder: data }
    }
    case 'upload-file': {
      const metadata: Record<string, any> = {
        name: config.fileName || config.name || 'Untitled',
        mimeType: config.mimeType || 'application/octet-stream',
      }
      if (config.parents) {
        metadata.parents = Array.isArray(config.parents) ? config.parents : [config.parents]
      }
      const formData = new FormData()
      formData.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' })
      )
      const content = config.content || config.fileContent
      const blob =
        typeof content === 'string'
          ? new Blob(
              [
                typeof (globalThis as any).Buffer !== 'undefined'
                  ? (globalThis as any).Buffer.from(content, 'base64')
                  : Uint8Array.from(atob(content), (c: string) => c.charCodeAt(0)),
              ],
              { type: metadata.mimeType }
            )
          : new Blob([content], { type: metadata.mimeType })
      formData.append('file', blob, config.fileName || 'file')
      const res = await fetch(uploadUrl + 'files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        body: formData,
      })
      const data = await __readJson(res)
      if (!res.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to upload' }
      }
      return { success: true, file: data }
    }
    case 'download-file': {
      const res = await fetch(baseUrl + 'files/' + config.fileId + '?alt=media', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + accessToken },
      })
      if (!res.ok) {
        const data = await __readJson(res)
        return { success: false, error: (data.error && data.error.message) || 'Failed to download' }
      }
      const buf = await res.arrayBuffer()
      const base64 =
        typeof (globalThis as any).Buffer !== 'undefined'
          ? (globalThis as any).Buffer.from(buf).toString('base64')
          : btoa(String.fromCharCode.apply(null, new Uint8Array(buf) as any))
      return { success: true, content: base64, mimeType: res.headers.get('content-type') || '' }
    }
    case 'update-file': {
      const body: Record<string, any> = {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      const res = await fetch(baseUrl + 'files/' + config.fileId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(res)
      if (!res.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to update' }
      }
      return { success: true, file: data }
    }
    case 'delete-file': {
      const res = await fetch(baseUrl + 'files/' + config.fileId, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) {
        const data = await __readJson(res)
        return { success: false, error: (data.error && data.error.message) || 'Failed to delete' }
      }
      return { success: true }
    }
    case 'search-files': {
      let url = baseUrl + 'files?q=' + encodeURIComponent(config.q || config.query || '')
      if (config.pageSize) {
        url += '&pageSize=' + config.pageSize
      }
      if (config.pageToken) {
        url += '&pageToken=' + encodeURIComponent(config.pageToken)
      }
      if (config.fields) {
        url += '&fields=' + encodeURIComponent(config.fields)
      }
      const res = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(res)
      if (!res.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to search' }
      }
      return { success: true, files: data.files || [], nextPageToken: data.nextPageToken }
    }
    case 'share-file': {
      const perm: Record<string, any> = {
        type: config.type || 'user',
        role: config.role || 'reader',
      }
      if (config.emailAddress) {
        perm.emailAddress = config.emailAddress
      }
      if (config.domain) {
        perm.domain = config.domain
      }
      let shareUrl = baseUrl + 'files/' + config.fileId + '/permissions'
      if (config.sendNotificationEmail === false) {
        shareUrl += '?sendNotificationEmail=false'
      }
      const res = await fetch(shareUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(perm),
      })
      const data = await __readJson(res)
      if (!res.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to share' }
      }
      return { success: true, permission: data }
    }
    case 'remove-permission': {
      const res = await fetch(
        baseUrl + 'files/' + config.fileId + '/permissions/' + config.permissionId,
        { method: 'DELETE', headers }
      )
      if (!res.ok) {
        const data = await __readJson(res)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to remove permission',
        }
      }
      return { success: true }
    }
    case 'copy-file': {
      const body: Record<string, any> = { name: config.name || config.copyName }
      if (config.parents) {
        body.parents = Array.isArray(config.parents) ? config.parents : [config.parents]
      }
      const res = await fetch(baseUrl + 'files/' + config.fileId + '/copy', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(res)
      if (!res.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to copy' }
      }
      return { success: true, file: data }
    }
    case 'move-file': {
      const qs: string[] = []
      if (config.addParents) {
        qs.push(
          'addParents=' +
            encodeURIComponent(
              Array.isArray(config.addParents) ? config.addParents.join(',') : config.addParents
            )
        )
      }
      if (config.removeParents) {
        qs.push(
          'removeParents=' +
            encodeURIComponent(
              Array.isArray(config.removeParents)
                ? config.removeParents.join(',')
                : config.removeParents
            )
        )
      }
      const res = await fetch(
        baseUrl + 'files/' + config.fileId + (qs.length ? '?' + qs.join('&') : ''),
        {
          method: 'PATCH',
          headers,
          body: '{}',
        }
      )
      const data = await __readJson(res)
      if (!res.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to move' }
      }
      return { success: true, file: data }
    }
    default:
      throw new Error('Unknown integration-google-drive action: ' + action)
  }
}
export const integrationGoogleDrive: IntegrationHandlerGenerator = {
  nodeType: 'integration-google-drive',
  executionEnv: 'server',
  secretFields: ['accessToken', 'serviceAccountCredentials'],
  generateHandler(): string {
    return handlerToString(integration_google_drive)
  },
}
