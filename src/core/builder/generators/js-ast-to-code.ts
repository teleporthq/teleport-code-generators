// @ts-ignore
import babelGenerator from '@babel/generator'
// @ts-ignore
import { format } from 'prettier/standalone'
// @ts-ignore
import parserPlugin from 'prettier/parser-babylon'

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
    plugins: [parserPlugin],
    parser: 'babel',
  })

  return formatted
}
