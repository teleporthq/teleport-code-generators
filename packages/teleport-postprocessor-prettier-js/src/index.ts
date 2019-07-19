import { format } from 'prettier/standalone'

import parserBabylon from 'prettier/parser-babylon'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { PostProcessingFunction } from '@teleporthq/teleport-types'

const processor: PostProcessingFunction = (codeChunks) => {
  if (codeChunks[FILE_TYPE.JS]) {
    codeChunks[FILE_TYPE.JS] = format(codeChunks[FILE_TYPE.JS], {
      ...PRETTIER_CONFIG,
      plugins: [parserBabylon, parserPostCSS],
      parser: 'babel',
    })
  } else {
    console.warn('No code chunk of type JS found, prettier-js did not perform any operation')
  }

  return codeChunks
}

export default processor
