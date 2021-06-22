// @ts-ignore
import { format } from 'prettier/esm/standalone.mjs'
// @ts-ignore
import parserHTML from 'prettier/esm/parser-html.mjs'

import { Constants } from '@teleporthq/teleport-shared'
import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPrettierHTMLPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FileType.HTML
  const formatOptions = { ...Constants.PRETTIER_CONFIG, ...options.formatOptions }

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        htmlWhitespaceSensitivity: 'ignore',
        plugins: [parserHTML],
        parser: 'html',
      })
    } else {
      console.warn('No code chunk of type HTML found, prettier-html did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPrettierHTMLPostProcessor()
