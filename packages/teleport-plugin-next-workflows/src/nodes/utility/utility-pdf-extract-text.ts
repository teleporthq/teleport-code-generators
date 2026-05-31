import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_pdf_extract_text(config: any, context: Record<string, unknown>) {
  const fileUrl = config.fileUrl || ''
  const fileBase64 = config.fileBase64 || ''
  const maxPages = config.maxPages !== undefined ? Number(config.maxPages) : 0

  if (!fileUrl && !fileBase64) {
    return { text: null, pages: 0, error: 'No file provided. Supply fileUrl or fileBase64.' }
  }

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const pdfParse = __nodeRequire('pdf-parse')
    let buffer: Buffer

    if (fileBase64) {
      let base64Data = fileBase64
      if (base64Data.indexOf(',') !== -1) {
        base64Data = base64Data.split(',')[1]
      }
      buffer = (globalThis as any).Buffer.from(base64Data, 'base64')
    } else {
      const response = await fetch(fileUrl)
      if (!response.ok) {
        return { text: null, pages: 0, error: 'Failed to fetch PDF: HTTP ' + response.status }
      }
      const arrayBuffer = await response.arrayBuffer()
      buffer = (globalThis as any).Buffer.from(arrayBuffer)
    }

    if (buffer.length === 0) {
      return { text: null, pages: 0, error: 'PDF file is empty' }
    }

    const opts: Record<string, any> = {}
    if (maxPages > 0) {
      opts.max = maxPages
    }

    const data = await pdfParse(buffer, opts)

    return {
      text: data.text || '',
      pages: data.numpages || 0,
      info: data.info || {},
      metadata: data.metadata || null,
    }
  } catch (err: unknown) {
    return { text: null, pages: 0, error: (err as Error).message }
  }
}
export const utilityPdfExtractText: NodeHandlerGenerator = {
  nodeType: 'utility-pdf-extract-text',
  executionEnv: 'server',
  dependencies: {
    'pdf-parse': '^1.1.1',
  },
  generateHandler(): string {
    return handlerToString(utility_pdf_extract_text)
  },
}
