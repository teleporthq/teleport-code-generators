import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { PostProcessor, PrettierFormatOptions } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FILE_TYPE.HTML
  const formatOptions = { ...PRETTIER_CONFIG, ...options.formatOptions }

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        htmlWhitespaceSensitivity: 'ignore',
        plugins: [parserHTML, parserPostCSS],
        parser: 'html',
      })
    } else {
      console.warn('No code chunk of type HTML found, prettier-html did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPostProcessor()
