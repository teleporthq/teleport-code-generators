import { format } from 'prettier/standalone'
import parserPlugin from 'prettier/parser-html'

import { PRETTIER_CONFIG } from '../../../shared/constants'
import { GeneratorFunction } from '../../../shared/types'

export const generator: GeneratorFunction = (htmlObject: any) => {
  const unformatedString = htmlObject.html() as string

  const formatted = format(unformatedString, {
    ...PRETTIER_CONFIG,
    htmlWhitespaceSensitivity: 'ignore',
    plugins: [parserPlugin],
    parser: 'html',
  })
  return formatted
}
