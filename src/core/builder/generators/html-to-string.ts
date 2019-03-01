import * as prettier from 'prettier/standalone'
import parserPlugin from 'prettier/parser-html'

import { GeneratorFunction } from '../../../shared/types'

export const generator: GeneratorFunction = (htmlObject: any) => {
  const unformatedString = htmlObject.html() as string

  const formatted = prettier.format(unformatedString, {
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
    semi: false,
    singleQuote: false,
    trailingComma: 'none',
    bracketSpacing: true,
    jsxBracketSameLine: false,

    plugins: [parserPlugin],
    parser: 'html',
  })
  return formatted
}
