// @ts-ignore
import babelGenerator from '@babel/generator'
import * as types from '@babel/types'
// @ts-ignore
import { format } from 'prettier/standalone'
// @ts-ignore
import parserPlugin from 'prettier/parser-babylon'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { CodeGeneratorFunction } from '../../../shared/types'

export const generator: CodeGeneratorFunction<types.Node> = (ast) => {
  const code = babelGenerator(ast).code

  const formatted = format(code, {
    ...PRETTIER_CONFIG,
    plugins: [parserPlugin],
    parser: 'babel',
  })

  return formatted
}
