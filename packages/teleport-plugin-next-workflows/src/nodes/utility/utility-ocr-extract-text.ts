import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_ocr_extract_text(config: any, context: Record<string, unknown>) {
  const imageUrl = config.imageUrl || ''
  const imageBase64 = config.imageBase64 || ''
  const language = config.language || 'eng'
  const mode = config.mode || 'default'

  if (!imageUrl && !imageBase64) {
    return {
      text: null,
      confidence: 0,
      error: 'No image provided. Supply imageUrl or imageBase64.',
    }
  }

  try {
    const Tesseract = require('tesseract.js')

    let source: string
    if (imageBase64) {
      source = imageBase64
      if (source.indexOf('data:') !== 0 && source.indexOf(',') === -1) {
        source = 'data:image/png;base64,' + source
      }
    } else {
      source = imageUrl
    }

    const ocrOpts: Record<string, any> = {}
    if (mode === 'sparse') {
      ocrOpts.tessedit_pageseg_mode = '11'
    } else if (mode === 'single-line') {
      ocrOpts.tessedit_pageseg_mode = '7'
    } else if (mode === 'single-word') {
      ocrOpts.tessedit_pageseg_mode = '8'
    }

    const result = await Tesseract.recognize(source, language, ocrOpts)

    const words: any[] = []
    if (result.data && result.data.words) {
      for (let w = 0; w < result.data.words.length; w++) {
        const word = result.data.words[w]
        words.push({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox,
        })
      }
    }

    const lines: string[] = []
    if (result.data && result.data.lines) {
      for (let ln = 0; ln < result.data.lines.length; ln++) {
        lines.push(result.data.lines[ln].text)
      }
    }

    return {
      text: result.data ? result.data.text : '',
      confidence: result.data ? result.data.confidence : 0,
      words,
      lines,
    }
  } catch (err: unknown) {
    return { text: null, confidence: 0, error: (err as Error).message }
  }
}
export const utilityOcrExtractText: NodeHandlerGenerator = {
  nodeType: 'utility-ocr-extract-text',
  executionEnv: 'server',
  dependencies: {
    'tesseract.js': '^4.1.0',
  },
  generateHandler(): string {
    return handlerToString(utility_ocr_extract_text)
  },
}
