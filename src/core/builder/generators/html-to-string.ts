import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import toHTML from 'hast-util-to-html'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { CodeGeneratorFunction, HastNode } from '../../../shared/types'

export const generator: CodeGeneratorFunction<HastNode> = (htmlObject) => {
  const unformatedString = toHTML(htmlObject)

  const formatted = format(unformatedString, {
    ...PRETTIER_CONFIG,
    htmlWhitespaceSensitivity: 'ignore',
    plugins: [parserHTML, parserPostCSS],
    parser: 'html',
  })
  return formatted
}
