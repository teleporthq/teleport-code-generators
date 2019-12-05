import { Node } from '@babel/types'
import * as babel from '@babel/core'
// @ts-ignore
import pluginJSXLITHtml from 'babel-plugin-transform-jsx-lit-html'

import { CodeGeneratorFunction } from '@teleporthq/teleport-types'

const { transformFromAstSync } = babel

export const generator: CodeGeneratorFunction<Node> = (ast) => {
  const inputAST = {
    type: 'Program',
    body: [ast],
  }
  // @ts-ignore
  const transformedAST = transformFromAstSync(inputAST, null, {
    plugins: [pluginJSXLITHtml],
  })
  return transformedAST.code
}
