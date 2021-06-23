import babelGenerator from '@babel/generator'
import types from '@babel/types'

import { CodeGeneratorFunction } from '@teleporthq/teleport-types'

export const generator: CodeGeneratorFunction<types.Node> = (ast) => {
  return babelGenerator(ast, { jsescOption: { minimal: true } }).code
}
