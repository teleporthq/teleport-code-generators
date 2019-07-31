import { format } from 'prettier/standalone'

import parserBabylon from 'prettier/parser-babylon'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { PostProcessor, PrettierFormatOptions } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FILE_TYPE.JS
  const formatOptions = { ...PRETTIER_CONFIG, ...options.formatOptions }

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        plugins: [parserBabylon, parserPostCSS],
        parser: 'babel',
      })
    } else {
      console.warn('No code chunk of type JS found, prettier-js did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPostProcessor()
