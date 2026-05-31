import { NodeHandlerGenerator, handlerToString } from '../types'

async function file_storage_list(config: any, _context: any) {
  // `globalThis.process` (member access) survives the GUI's webpack bundling of
  // this handler; a bare `process` gets rewritten to an undefined name in the
  // serialized `fn.toString()` output. See payment-charge-user.ts for details.
  const env = (globalThis as any).process.env
  const storageUrl = env.RUNTIME_STORAGE_URL
  const apiKey = env.RUNTIME_STORAGE_API_KEY
  const projectId = env.RUNTIME_STORAGE_PROJECT_ID

  if (!storageUrl || !apiKey || !projectId) {
    return { files: [], count: 0, totalSize: 0, error: 'Runtime storage is not configured' }
  }

  try {
    const params = new URLSearchParams()
    if (config.folder) {
      params.set('folder', String(config.folder))
    }
    if (config.limit !== undefined && config.limit !== null) {
      params.set('limit', String(config.limit))
    }
    if (config.skip !== undefined && config.skip !== null) {
      params.set('skip', String(config.skip))
    }
    if (config.sortBy) {
      params.set('sortBy', String(config.sortBy))
    }
    if (config.sortOrder) {
      params.set('sortOrder', String(config.sortOrder))
    }
    if (config.mimeTypeFilter) {
      params.set('mimeTypeFilter', String(config.mimeTypeFilter))
    }
    if (config.nameFilter) {
      params.set('nameFilter', String(config.nameFilter))
    }

    const qs = params.toString()
    const url = storageUrl + '/project/' + projectId + '/files' + (qs ? '?' + qs : '')

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKey },
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        files: [],
        count: 0,
        totalSize: 0,
        error: data.error || data.message || 'Failed to list files',
      }
    }

    return {
      files: data.files || [],
      count: data.count || 0,
      totalSize: data.totalSize || 0,
    }
  } catch (err: unknown) {
    return { files: [], count: 0, totalSize: 0, error: (err as Error).message }
  }
}

export const fileStorageList: NodeHandlerGenerator = {
  nodeType: 'file-storage-list',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(file_storage_list)
  },
}
