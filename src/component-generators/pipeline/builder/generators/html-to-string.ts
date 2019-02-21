import * as prettier from 'prettier/standalone'
import parserPlugin from 'prettier/parser-html'

import { GeneratorFunction } from '../../../types'

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
    // parser(text:string, { babylon }: any) {
    //   const tempAst = babylon(text);
    //   // console.log(
    //   //   JSON.stringify(
    //   //     tempAst.program.body, null, 4
    //   //   ),
    //   //   JSON.stringify(
    //   //     types.file(types.program([ast]), null, null).program.body, null, 4
    //   //   )
    //   // )
    //   return types.file(types.program([ast]), [], null)
    // }
  })
  return formatted
}
