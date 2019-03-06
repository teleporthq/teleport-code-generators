import { format } from 'prettier/standalone'
import parserPlugin from 'prettier/parser-html'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { CodeGeneratorFunction } from '../../../shared/types'

export const generator: CodeGeneratorFunction<CheerioStatic> = (htmlObject) => {
  const unformatedString = htmlObject.html()

  const formatted = format(unformatedString, {
    ...PRETTIER_CONFIG,
    htmlWhitespaceSensitivity: 'ignore',
    plugins: [parserPlugin],
    parser: 'html',
  })
  return formatted
}
