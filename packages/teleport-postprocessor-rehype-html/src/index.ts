// @ts-ignore
import rehype from 'rehype'
// @ts-ignore
import format from 'rehype-format'
// @ts-ignore
import parse from 'rehype-parse'

import { PostProcessor, PrettierFormatOptions, FileType } from '@teleporthq/teleport-types'

interface PostProcessorFactoryOptions {
  fileType?: string
  formatOptions?: PrettierFormatOptions
}

export const createPostProcessor = (options: PostProcessorFactoryOptions = {}) => {
  const fileType = options.fileType || FileType.HTML

  const processor: PostProcessor = (codeChunks) => {
    if (codeChunks[fileType]) {
      rehype()
        .use(parse, { fragment: true })
        .use(format)
        .process(codeChunks[fileType], (err: any, file: any) => {
          codeChunks[fileType] = String(file)
          if (err) {
            throw new Error(`Error occured in formatting with rehype, ${err}`)
          }
        })
    } else {
      console.warn('No code chunk of type HTML found, prettier-html did not perform any operation')
    }

    return codeChunks
  }

  return processor
}

export default createPostProcessor()
