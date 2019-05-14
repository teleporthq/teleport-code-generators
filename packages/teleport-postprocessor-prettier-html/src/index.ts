import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG, FILE_TYPE } from '@teleporthq/teleport-generator-shared/lib/constants'
import { PostProcessingFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

const processor: PostProcessingFunction = (codeChunks) => {
  if (codeChunks[FILE_TYPE.HTML]) {
    codeChunks[FILE_TYPE.HTML] = format(codeChunks[FILE_TYPE.HTML], {
      ...PRETTIER_CONFIG,
      htmlWhitespaceSensitivity: 'ignore',
      plugins: [parserHTML, parserPostCSS],
      parser: 'html',
    })
  } else {
    console.warn('No code chunk of type HTML found, prettier-html did not perform any operation')
  }

  return codeChunks
}

export default processor
