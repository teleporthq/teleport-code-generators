import babelGenerator from '@babel/generator'
import * as types from '@babel/types'

import { CodeGeneratorFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

export const generator: CodeGeneratorFunction<types.Node> = (ast) => {
  return babelGenerator(ast).code
}
