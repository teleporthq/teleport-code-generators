import babelGenerator from '@babel/generator'
import { Node } from '@babel/types'

import { CodeGeneratorFunction } from '@teleporthq/teleport-types'

export const generator: CodeGeneratorFunction<Node> = (ast) => {
  return babelGenerator(ast, { jsescOption: { minimal: true } }).code
}
