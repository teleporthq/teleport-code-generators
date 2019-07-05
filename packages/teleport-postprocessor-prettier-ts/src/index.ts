import { format } from 'prettier/standalone'

import parserTypescript from 'prettier/parser-typescript'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG, FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'
import { PostProcessingFunction } from '@teleporthq/teleport-types'

const processor: PostProcessingFunction = (codeChunks) => {
  if (codeChunks[FILE_TYPE.TS]) {
    codeChunks[FILE_TYPE.TS] = format(codeChunks[FILE_TYPE.TS], {
      ...PRETTIER_CONFIG,
      plugins: [parserTypescript, parserPostCSS],
      parser: 'typescript',
    })
  } else {
    console.warn(
      'No code chunk of type TS found, prettier-typescript did not perform any operation'
    )
  }

  return codeChunks
}

export default processor
