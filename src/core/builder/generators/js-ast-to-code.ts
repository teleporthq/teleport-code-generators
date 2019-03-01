// import * as types from '@babel/types'
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
