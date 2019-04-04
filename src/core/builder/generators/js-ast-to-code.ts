// @ts-ignore
import babelGenerator from '@babel/generator'
import * as types from '@babel/types'
// @ts-ignore
import { format } from 'prettier/standalone'

// @ts-ignore
import parserBabylon from 'prettier/parser-babylon'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { CodeGeneratorFunction } from '../../../typings/generators'

export const generator: CodeGeneratorFunction<types.Node> = (ast) => {
  const code = babelGenerator(ast).code

  const formatted = format(code, {
    ...PRETTIER_CONFIG,
    plugins: [parserBabylon, parserPostCSS],
    parser: 'babel',
  })

  return formatted
}
