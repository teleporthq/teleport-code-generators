import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_dropbox(config: any, context: Record<string, unknown>) {
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
  // Dropbox returns structured `{ error_summary, error: { '.tag', required_scope, … } }`
  // bodies on failure. The bare `error_summary` string is often truncated
  // (e.g. "missing_scope/") — surface the structured fields when present so
  // the user knows exactly which OAuth scope to add.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const __dropboxError = (data: any, fallback: string): string => {
    if (data && typeof data === 'object') {
      const err = data.error
      if (err && typeof err === 'object') {
        if (err.required_scope) {
          return (
            'Dropbox token is missing the OAuth scope "' +
            err.required_scope +
            '". Add it to your Dropbox app and re-issue the token.'
          )
        }
        const tag = err['.tag']
        if (tag === 'missing_scope') {
          return 'Dropbox token is missing a required OAuth scope. Re-authorize the Dropbox app with files.metadata.read, files.content.read, sharing.read (and any write scopes you need).'
        }
        if (tag === 'expired_access_token' || tag === 'invalid_access_token') {
          return 'Dropbox access token is invalid or expired. Re-issue it from your Dropbox app console.'
        }
      }
      if (data.error_summary) {
        return data.error_summary
      }
      if (typeof data.error === 'string') {
        return data.error
      }
    }
    return fallback
  }
  const accessToken = config.accessToken
  const action = config.action
  const headers = {
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'upload-file': {
      // Schema canonical name is `destinationPath`; older workflows used `path`. Accept either.
      const dropboxPath = config.destinationPath || config.path
      const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            path: dropboxPath,
            mode: config.mode || 'add',
            autorename: config.autorename !== false,
            mute: config.mute || false,
          }),
        },
        body: config.content,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to upload file') }
      }
      return { success: true, file: data }
    }
    case 'download-file': {
      const response = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Dropbox-API-Arg': JSON.stringify({
            path: config.path,
          }),
        },
      })
      if (!response.ok) {
        let errData: Record<string, any> = {}
        try {
          errData = await __readJson(response)
        } catch (e) {}
        return { success: false, error: __dropboxError(errData, 'Failed to download file') }
      }
      const metadata = JSON.parse(response.headers.get('dropbox-api-result') || '{}')
      const content = await response.arrayBuffer()
      return { success: true, metadata, content }
    }
    case 'list-folder': {
      const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: config.path || '',
          recursive: config.recursive || false,
          include_deleted: config.includeDeleted || false,
          limit: config.limit || 100,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to list folder') }
      }
      return { success: true, entries: data.entries, cursor: data.cursor, hasMore: data.has_more }
    }
    case 'delete-file': {
      const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: config.path }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to delete') }
      }
      return { success: true, metadata: data.metadata }
    }
    case 'move-file': {
      const response = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_path: config.fromPath, to_path: config.toPath }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to move') }
      }
      return { success: true, metadata: data.metadata }
    }
    case 'copy-file': {
      const response = await fetch('https://api.dropboxapi.com/2/files/copy_v2', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_path: config.fromPath, to_path: config.toPath }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to copy') }
      }
      return { success: true, metadata: data.metadata }
    }
    case 'create-folder': {
      const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: config.path, autorename: config.autorename || false }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to create folder') }
      }
      return { success: true, metadata: data.metadata }
    }
    case 'get-metadata': {
      const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: config.path }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to get metadata') }
      }
      return { success: true, metadata: data }
    }
    case 'get-shared-link': {
      const response = await fetch(
        'https://api.dropboxapi.com/2/sharing/get_shared_link_metadata',
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: config.url }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to get shared link') }
      }
      return { success: true, link: data }
    }
    case 'create-shared-link': {
      const response = await fetch(
        'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: config.path, settings: config.settings || {} }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to create shared link') }
      }
      return { success: true, link: data }
    }
    case 'search-files': {
      const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: config.query, options: config.options || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to search') }
      }
      return { success: true, matches: data.matches }
    }
    case 'get-thumbnail': {
      const response = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Dropbox-API-Arg': JSON.stringify({
            resource: { '.tag': 'path', path: config.path },
            format: config.format || 'jpeg',
            size: config.size || 'w256h256',
          }),
        },
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: __dropboxError(data, 'Failed to get thumbnail') }
      }
      const buf = await response.arrayBuffer()
      return { success: true, content: buf }
    }
    case 'get-account': {
      const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: __dropboxError(data, 'Failed to get account') }
      }
      return { success: true, account: data }
    }
    default:
      throw new Error('Unknown integration-dropbox action: ' + action)
  }
}
export const integrationDropbox: IntegrationHandlerGenerator = {
  nodeType: 'integration-dropbox',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_dropbox)
  },
}
