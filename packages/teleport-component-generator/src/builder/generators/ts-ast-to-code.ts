import * as ts from 'typescript'

import { CodeGeneratorFunction } from '@teleporthq/teleport-types'

export const generator: CodeGeneratorFunction<ts.Node> = (ast) => {
  const resultFile = ts.createSourceFile(
    '',
    '',
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ false,
    ts.ScriptKind.TS
  )

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  })

  const result = printer.printNode(ts.EmitHint.Unspecified, ast, resultFile)

  return result
}
