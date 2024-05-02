import standalone from 'prettier/standalone.js'
const { format } = standalone
import parserHTML from 'prettier/parser-html.js'

import { Constants } from '@teleporthq/teleport-shared'
import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
  strictHtmlWhitespaceSensitivity?: boolean
}

export const createPrettierHTMLPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FileType.HTML
  const formatOptions = { ...Constants.PRETTIER_CONFIG, ...options.formatOptions }
  const htmlWhitespaceSensitivity =
    options?.strictHtmlWhitespaceSensitivity === true ? 'strict' : 'ignore'

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        htmlWhitespaceSensitivity,
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
