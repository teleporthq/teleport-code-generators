import { CodeGenerator } from '@babel/generator'
import * as types from '@babel/types'
import { ASTStatementOrder } from '@teleporthq/teleport-shared'
import { CodeGeneratorFunction } from '@teleporthq/teleport-types'

export const generator: CodeGeneratorFunction<types.Node> = (ast) => {
  // Last line of defence before an AST becomes source code. The chunks that
  // arrive here were spliced together by many independent plugins, and a
  // misplaced insertion produces one of two silent time bombs: a hook pushed
  // AFTER the component's `return` (unreachable — the feature simply never
  // runs) or a declaration unshifted ABOVE the state it reads
  // (`ReferenceError: Cannot access 'ds_0_state' before initialization` at
  // render time). Both are invisible to source-text tests and to the build.
  //
  // `normalizeStatementOrder` proves a block broken before touching it, so a
  // healthy AST prints byte-identical to what it always printed. This is a
  // NET, not the fix: plugins are still expected to insert correctly (see
  // `ASTStatementOrder`'s insertion helpers), but a future plugin that gets it
  // wrong degrades to correct output instead of a broken page.
  ASTStatementOrder.normalizeStatementOrder(ast)

  const babelGenerator = new CodeGenerator(ast, { jsescOption: { minimal: true } })
  const { code } = babelGenerator.generate()
  return code
}
