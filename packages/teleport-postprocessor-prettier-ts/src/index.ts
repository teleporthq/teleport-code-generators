import { format } from 'prettier/standalone'

import parserTypescript from 'prettier/parser-typescript'

import { Constants } from '@teleporthq/teleport-shared'
import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPrettierTSPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const formatOptions = { ...Constants.PRETTIER_CONFIG, ...options.formatOptions }
  const fileType = options.fileType || FileType.TS

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        plugins: [parserTypescript],
        parser: 'typescript',
      })
    } else {
      console.warn('No code chunk of type JS found, prettier-ts did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPrettierTSPostProcessor()
