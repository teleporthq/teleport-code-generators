import { NodeHandlerGenerator, handlerToString } from '../types'

async function file_storage_delete(config: any, _context: any) {
  const fileId = config.fileId

  if (!fileId) {
    return { success: false, deletedFileId: '', error: 'fileId is required' }
  }

  // `globalThis.process` (member access) survives the GUI's webpack bundling of
  // this handler; a bare `process` gets rewritten to an undefined name in the
  // serialized `fn.toString()` output. See file-storage-list.ts for details.
  const env = (globalThis as any).process.env
  const storageUrl = env.RUNTIME_STORAGE_URL
  const apiKey = env.RUNTIME_STORAGE_API_KEY
  const projectId = env.RUNTIME_STORAGE_PROJECT_ID

  if (!storageUrl || !apiKey || !projectId) {
    return { success: false, deletedFileId: '', error: 'Runtime storage is not configured' }
  }

  try {
    const url =
      storageUrl + '/project/' + projectId + '/files/' + encodeURIComponent(String(fileId))

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + apiKey },
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        deletedFileId: '',
        error: data.error || data.message || 'Failed to delete file',
      }
    }

    return {
      success: data.success !== undefined ? data.success : true,
      deletedFileId: data.deletedFileId || String(fileId),
    }
  } catch (err: unknown) {
    return { success: false, deletedFileId: '', error: (err as Error).message }
  }
}

export const fileStorageDelete: NodeHandlerGenerator = {
  nodeType: 'file-storage-delete',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(file_storage_delete)
  },
}
