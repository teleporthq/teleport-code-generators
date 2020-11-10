import * as t from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ParsedASTNode, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { UIDLStyleValue } from '@teleporthq/teleport-types'

export const generatePropSyntax = (style: Record<string, UIDLStyleValue>) => {
  let tokensUsed = false
  return {
    transformedStyles: UIDLUtils.transformDynamicStyles(style, (styleValue) => {
      switch (styleValue.content.referenceType) {
        case 'prop':
          return new ParsedASTNode(
            ASTBuilders.createArrowFunctionWithMemberExpression('props', styleValue.content.id)
          )
        case 'token':
          tokensUsed = true
          return new ParsedASTNode(
            t.memberExpression(
              t.identifier('TOKENS'),
              t.identifier(
                StringUtils.capitalize(StringUtils.dashCaseToCamelCase(styleValue.content.id))
              )
            )
          )
        default:
          throw new Error(
            `Error running transformDynamicStyles in reactJSSComponentStyleChunksPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
          )
      }
    }),
    tokensUsed,
  }
}

export const createStylesHookDecleration = (types = t) => {
  return types.variableDeclaration('const', [
    types.variableDeclarator(
      t.identifier('projectStyles'),
      t.callExpression(t.identifier('useProjectStyles'), [])
    ),
  ])
}
