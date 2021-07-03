import standalone from 'prettier/standalone.js'
const { format } = standalone
import parserBabel from 'prettier/parser-babel.js'
import parserPostCSS from 'prettier/parser-postcss.js'

import { Constants } from '@teleporthq/teleport-shared'
import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPrettierJSXPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FileType.JS
  const formatOptions = { ...Constants.PRETTIER_CONFIG, ...options.formatOptions }
  const plugins = [parserBabel, parserPostCSS]

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      codeChunks[fileType] = format(codeChunks[fileType], {
        ...formatOptions,
        plugins,
        parser: 'babel',
      })
    } else {
      console.warn('No code chunk of type JS found, prettier-jsx did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPrettierJSXPostProcessor()
