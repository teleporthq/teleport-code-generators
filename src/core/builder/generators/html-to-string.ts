import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { CodeGeneratorFunction } from '../../../shared/types'

export const generator: CodeGeneratorFunction<CheerioStatic> = (htmlObject) => {
  const unformatedString = htmlObject.html()

  const formatted = format(unformatedString, {
    ...PRETTIER_CONFIG,
    htmlWhitespaceSensitivity: 'ignore',
    plugins: [parserHTML, parserPostCSS],
    parser: 'html',
  })
  return formatted
}
