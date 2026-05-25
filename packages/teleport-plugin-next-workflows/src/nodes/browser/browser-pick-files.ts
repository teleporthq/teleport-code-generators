import { NodeHandlerGenerator, handlerToString } from '../types'

// The returned shape must match the `browser-pick-files` context schema in
// `packages/workflow-schema/src/types/node-context-schemas.json`: each element
// of `files[]` carries `{ name, size, type, lastModified, data, dataURL }` and
// the top-level object exposes `fileCount`. Downstream workflow nodes
// (including the Upload Profile Image flow's `if fileCount > 0` gate and the
// `accountFormData.image = dataURL` preview write) rely on that contract.
async function browser_pick_files(config: any) {
  const accept = config.accept || ''
  const multiple = config.multiple || false

  try {
    const rawFiles = await new Promise<File[]>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      if (accept) {
        input.accept = accept
      }
      if (multiple) {
        input.multiple = true
      }
      input.style.display = 'none'

      input.addEventListener('change', () => {
        const fileList = Array.from(input.files || [])
        document.body.removeChild(input)
        resolve(fileList)
      })

      input.addEventListener('cancel', () => {
        document.body.removeChild(input)
        resolve([])
      })

      document.body.appendChild(input)
      input.click()
    })

    const readFile = (file: File) =>
      new Promise<{
        name: string
        size: number
        type: string
        lastModified: number
        data: string
        dataURL: string
      } | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataURL = typeof reader.result === 'string' ? reader.result : ''
          const commaIndex = dataURL.indexOf(',')
          const data = commaIndex >= 0 ? dataURL.slice(commaIndex + 1) : ''
          resolve({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            data,
            dataURL,
          })
        }
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })

    const readResults = await Promise.all(rawFiles.map(readFile))
    const files = readResults.filter((f) => f !== null)

    return { files, fileCount: files.length }
  } catch (err: unknown) {
    return { files: [], fileCount: 0, error: (err as Error).message }
  }
}

export const browserPickFiles: NodeHandlerGenerator = {
  nodeType: 'browser-pick-files',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_pick_files)
  },
}
