import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import unified from 'unified'
import htmlParser from 'rehype-stringify'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { CodeGeneratorFunction } from '../../../shared/types'

export const generator: CodeGeneratorFunction<any> = (htmlObject) => {
  const unformatedString = unified()
    .use(htmlParser)
    .stringify(htmlObject)

  const formatted = format(unformatedString, {
    ...PRETTIER_CONFIG,
    htmlWhitespaceSensitivity: 'ignore',
    plugins: [parserHTML, parserPostCSS],
    parser: 'html',
  })
  return formatted
}
