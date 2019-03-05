import babelGenerator from '@babel/generator'
import { format } from 'prettier/standalone'
import parserBabylon from 'prettier/parser-babylon'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { GeneratorFunction } from '../../../shared/types'

export const generator: GeneratorFunction = (anyContent) => {
  let ast = anyContent
  if (typeof anyContent === 'function') {
    ast = anyContent()
  }

  const code = babelGenerator(ast).code

  const formatted = format(code, {
    ...PRETTIER_CONFIG,
    plugins: [parserBabylon, parserPostCSS],
    parser: 'babel',
  })

  return formatted
}
