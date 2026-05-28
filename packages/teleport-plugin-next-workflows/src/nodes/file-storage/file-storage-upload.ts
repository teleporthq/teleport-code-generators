import { NodeHandlerGenerator, handlerToString } from '../types'

// `browser-pick-files` returns plain objects shaped like
// `{ name, size, type, lastModified, data, dataURL }` — see the context
// schema in `packages/workflow-schema/src/types/node-context-schemas.json`
// and the matching handler in `nodes/browser/browser-pick-files.ts`. Those
// objects are NOT `Blob` instances, so the previous `instanceof Blob`-only
// FormData appender silently dropped every picked file and the upstream
// runtime-storage proxy returned `{ error: "NO_FILES" }`. We now convert
// any item carrying a `dataURL` (the canonical encoding the picker emits)
// to a Blob before appending. Raw Blob/File values from other producers
// continue to work unchanged.
//
// All helpers are declared INSIDE `file_storage_upload` because
// `handlerToString` only serializes the function body via `Function.prototype
// .toString()`. Anything declared at module scope is invisible to the
// generated runtime and would `ReferenceError` at execution time.
async function file_storage_upload(config: any, _context: any) {
  const fileData = config.file

  if (!fileData) {
    return { files: [], error: 'No file provided' }
  }

  function dataURLToBlob(dataURL: string, fallbackMime: string): Blob | null {
    if (!dataURL || typeof dataURL !== 'string') {
      return null
    }
    const commaIdx = dataURL.indexOf(',')
    if (commaIdx < 0) {
      return null
    }
    const header = dataURL.slice(0, commaIdx)
    const payload = dataURL.slice(commaIdx + 1)
    const mimeMatch = header.match(/data:([^;]+)/)
    const mime =
      mimeMatch && mimeMatch[1] ? mimeMatch[1] : fallbackMime || 'application/octet-stream'
    const isBase64 = header.indexOf(';base64') !== -1
    let bytes: Uint8Array
    try {
      if (isBase64) {
        const binary = atob(payload)
        bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
      } else {
        const decoded = decodeURIComponent(payload)
        bytes = new Uint8Array(decoded.length)
        for (let j = 0; j < decoded.length; j++) {
          bytes[j] = decoded.charCodeAt(j)
        }
      }
    } catch (_e) {
      return null
    }
    return new Blob([bytes], { type: mime })
  }

  function appendFileEntry(formData: FormData, entry: any): boolean {
    if (!entry) {
      return false
    }
    if (entry instanceof Blob) {
      const nativeName = (entry as File).name
      if (nativeName) {
        formData.append('file', entry, nativeName)
      } else {
        formData.append('file', entry)
      }
      return true
    }
    if (typeof entry === 'object') {
      const blob = dataURLToBlob(String(entry.dataURL || ''), String(entry.type || ''))
      if (blob) {
        const fileName = entry.name ? String(entry.name) : 'file'
        formData.append('file', blob, fileName)
        return true
      }
    }
    return false
  }

  try {
    const formData = new FormData()
    let appendedCount = 0

    if (Array.isArray(fileData)) {
      for (let k = 0; k < fileData.length; k++) {
        if (appendFileEntry(formData, fileData[k])) {
          appendedCount += 1
        }
      }
    } else if (appendFileEntry(formData, fileData)) {
      appendedCount += 1
    }

    if (appendedCount === 0) {
      return { files: [], error: 'Invalid file data' }
    }

    if (
      config.allowedMimeTypes &&
      Array.isArray(config.allowedMimeTypes) &&
      config.allowedMimeTypes.length > 0
    ) {
      formData.append('allowedMimeTypes', config.allowedMimeTypes.join(','))
    }

    if (config.maxFileSize !== undefined && config.maxFileSize !== null) {
      formData.append('maxFileSize', String(config.maxFileSize))
    }

    if (config.folder) {
      formData.append('folder', String(config.folder))
    }

    const response = await fetch('/api/runtime-storage/upload', {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        files: [],
        error: data.error || data.message || 'Upload failed',
        statusCode: response.status,
        currentUsage: data.currentUsage,
        storageLimit: data.storageLimit,
        requestedSize: data.requestedSize,
      }
    }

    return { files: data.files || [] }
  } catch (err: unknown) {
    return { files: [], error: (err as Error).message }
  }
}

export const fileStorageUpload: NodeHandlerGenerator = {
  nodeType: 'file-storage-upload',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(file_storage_upload)
  },
}
