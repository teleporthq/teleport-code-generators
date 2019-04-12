import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import toHTML from '@starptech/prettyhtml-hast-to-html'
import { PRETTIER_CONFIG } from '@teleporthq/teleport-shared/lib/constants'
import { CodeGeneratorFunction, HastNode } from '@teleporthq/teleport-types-generator'

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
