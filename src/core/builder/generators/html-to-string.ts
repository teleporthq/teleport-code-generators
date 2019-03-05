import { format } from 'prettier/standalone'

import parserHTML from 'prettier/parser-html'
import parserPostCSS from 'prettier/parser-postcss'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { GeneratorFunction } from '../../../shared/types'

export const generator: GeneratorFunction = (htmlObject: any) => {
  const unformatedString = htmlObject.html() as string

  const formatted = format(unformatedString, {
    ...PRETTIER_CONFIG,
    htmlWhitespaceSensitivity: 'ignore',
    plugins: [parserHTML, parserPostCSS],
    parser: 'html',
  })
  return formatted
}
