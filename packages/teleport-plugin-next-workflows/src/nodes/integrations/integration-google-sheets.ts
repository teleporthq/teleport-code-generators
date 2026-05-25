import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_google_sheets(config: any, context: Record<string, unknown>) {
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
      const scope = config.scope || 'https://www.googleapis.com/auth/spreadsheets'
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
  const baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'append-row': {
      const range = config.range || 'Sheet1'
      let url = baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range) + ':append'
      url = url + '?valueInputOption=' + (config.valueInputOption || 'USER_ENTERED')
      url = url + '&insertDataOption=' + (config.insertDataOption || 'INSERT_ROWS')
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          values: [config.values || []],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to append row',
        }
      }
      return { success: true, updates: data.updates }
    }
    case 'get-rows': {
      const range = config.range || 'Sheet1'
      let url = baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range)
      const params = []
      if (config.majorDimension) {
        params.push('majorDimension=' + config.majorDimension)
      }
      if (config.valueRenderOption) {
        params.push('valueRenderOption=' + config.valueRenderOption)
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
        return { success: false, error: (data.error && data.error.message) || 'Failed to get rows' }
      }
      return { success: true, values: data.values || [], range: data.range }
    }
    case 'update-cell': {
      const range = config.range || 'Sheet1!A1'
      let url = baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range)
      url = url + '?valueInputOption=' + (config.valueInputOption || 'USER_ENTERED')
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          values: [[config.value]],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update cell',
        }
      }
      return { success: true, updatedCells: data.updatedCells, updatedRange: data.updatedRange }
    }
    case 'create-spreadsheet': {
      const body = {
        properties: { title: config.title || 'Untitled' },
        sheets: config.sheets || [],
      }
      const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to create' }
      }
      return { success: true, spreadsheet: data }
    }
    case 'get-spreadsheet': {
      let url = baseUrl + config.spreadsheetId
      if (config.includeGridData) {
        url += '?includeGridData=true'
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get spreadsheet',
        }
      }
      return { success: true, spreadsheet: data }
    }
    case 'add-sheet': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: config.title || 'Sheet' } } }],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to add sheet',
        }
      }
      return { success: true, replies: data.replies }
    }
    case 'delete-sheet': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: config.sheetId } }] }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete sheet',
        }
      }
      return { success: true }
    }
    case 'rename-sheet': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: config.sheetId, title: config.title },
                fields: 'title',
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.message) || 'Failed to rename' }
      }
      return { success: true }
    }
    case 'insert-row': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: config.sheetId,
                  dimension: 'ROWS',
                  startIndex: config.index || 0,
                  endIndex: (config.index || 0) + (config.count || 1),
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
          error: (data.error && data.error.message) || 'Failed to insert row',
        }
      }
      return { success: true }
    }
    case 'update-row': {
      const range = config.range || 'Sheet1!A1'
      const url =
        baseUrl +
        config.spreadsheetId +
        '/values/' +
        encodeURIComponent(range) +
        '?valueInputOption=' +
        (config.valueInputOption || 'USER_ENTERED')
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: [config.values || []] }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update row',
        }
      }
      return { success: true, updatedRange: data.updatedRange }
    }
    case 'delete-row': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: config.sheetId,
                  dimension: 'ROWS',
                  startIndex: config.startIndex,
                  endIndex: config.endIndex,
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
          error: (data.error && data.error.message) || 'Failed to delete row',
        }
      }
      return { success: true }
    }
    case 'update-range': {
      const range = config.range || 'Sheet1!A1'
      const url =
        baseUrl +
        config.spreadsheetId +
        '/values/' +
        encodeURIComponent(range) +
        '?valueInputOption=' +
        (config.valueInputOption || 'USER_ENTERED')
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: config.values || [] }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update range',
        }
      }
      return { success: true, updatedRange: data.updatedRange }
    }
    case 'get-cell': {
      const range = config.range || 'Sheet1!A1'
      const response = await fetch(
        baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range),
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to get cell' }
      }
      return { success: true, values: data.values || [], range: data.range }
    }
    case 'get-range': {
      const range = config.range || 'Sheet1'
      const response = await fetch(
        baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range),
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get range',
        }
      }
      return { success: true, values: data.values || [], range: data.range }
    }
    case 'clear-range': {
      const range = config.range || 'Sheet1'
      const response = await fetch(
        baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range) + ':clear',
        { method: 'POST', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.message) || 'Failed to clear' }
      }
      return { success: true }
    }
    case 'clear-sheet': {
      const range = config.sheetName || 'Sheet1'
      const response = await fetch(
        baseUrl + config.spreadsheetId + '/values/' + encodeURIComponent(range) + ':clear',
        { method: 'POST', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to clear sheet',
        }
      }
      return { success: true }
    }
    case 'format-cells': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: config.rangeObj || {
                  sheetId: config.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                cell: { userEnteredFormat: config.format || {} },
                fields: 'userEnteredFormat',
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.message) || 'Failed to format' }
      }
      return { success: true }
    }
    case 'find-replace': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              findReplace: {
                find: config.find,
                replacement: config.replacement,
                sheetId: config.sheetId,
                all: config.all !== false,
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to find replace',
        }
      }
      return { success: true }
    }
    case 'sort-range': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              sortRange: {
                range: config.rangeObj || { sheetId: config.sheetId },
                sortSpecs: config.sortSpecs || [],
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.message) || 'Failed to sort' }
      }
      return { success: true }
    }
    case 'copy-paste': {
      const response = await fetch(baseUrl + config.spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: [
            {
              copyPaste: {
                source: config.source || {},
                destination: config.destination || {},
                pasteType: config.pasteType || 'PASTE_NORMAL',
              },
            },
          ],
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to copy paste',
        }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-google-sheets action: ' + action)
  }
}
export const integrationGoogleSheets: IntegrationHandlerGenerator = {
  nodeType: 'integration-google-sheets',
  executionEnv: 'server',
  secretFields: ['accessToken', 'serviceAccountCredentials'],
  generateHandler(): string {
    return handlerToString(integration_google_sheets)
  },
}
