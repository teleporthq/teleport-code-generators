import { html as beautifyHTML } from 'js-beautify'

import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FileType.HTML

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      const result = beautifyHTML(codeChunks[fileType], {
        wrap_line_length: 80,
        end_with_newline: true,
        preserve_newlines: true,
      })
      codeChunks[fileType] = result
    } else {
      console.warn('No code chunk of type HTML found, prettier-html did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPostProcessor()
