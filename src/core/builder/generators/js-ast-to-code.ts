import babelGenerator from '@babel/generator'
import * as prettier from 'prettier/standalone'
import parserPlugin from 'prettier/parser-babylon'

import { GeneratorFunction } from '../../../shared/types'

export const generator: GeneratorFunction = (anyContent) => {
  let ast = anyContent
  if (typeof anyContent === 'function') {
    ast = anyContent()
  }

  const formatted = prettier.format(babelGenerator(ast).code, {
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
    semi: false,
    singleQuote: false,
    trailingComma: 'none',
    bracketSpacing: true,
    jsxBracketSameLine: false,

    plugins: [parserPlugin],
    parser: 'babel',
  })

  return formatted
}
