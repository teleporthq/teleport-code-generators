import * as t from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ParsedASTNode, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { UIDLStyleValue } from '@teleporthq/teleport-types'

export const generatePropSyntax = (style: Record<string, UIDLStyleValue>) => {
  return UIDLUtils.transformDynamicStyles(style, (styleValue) => {
    if (styleValue.content.referenceType === 'prop') {
      return new ParsedASTNode(
        ASTBuilders.createArrowFunctionWithMemberExpression('props', styleValue.content.id)
      )
    }
    throw new Error(
      `Error running transformDynamicStyles in reactJSSComponentStyleChunksPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
    )
  })
}

export const createStylesHookDecleration = (types = t) => {
  return types.variableDeclaration('const', [
    types.variableDeclarator(
      t.identifier('projectStyles'),
      t.callExpression(t.identifier('useProjectStyles'), [])
    ),
  ])
}
