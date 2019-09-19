import { format } from 'prettier/standalone'

import parserBabylon from 'prettier/parser-babylon'
import parserPostCSS from 'prettier/parser-postcss'
import parserTypescript from 'prettier/parser-typescript'

import { Constants } from '@teleporthq/teleport-shared'
import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FileType.JS
  const formatOptions = { ...Constants.PRETTIER_CONFIG, ...options.formatOptions }

  const jsParser = fileType === FileType.TS ? parserTypescript : parserBabylon
  const plugins = [jsParser, parserPostCSS]
  const parser = fileType === FileType.TS ? 'typescript' : 'babel'

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        plugins,
        parser,
      })
    } else {
      console.warn('No code chunk of type JS found, prettier-js did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPostProcessor()
