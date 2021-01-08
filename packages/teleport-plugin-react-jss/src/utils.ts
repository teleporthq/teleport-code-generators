import * as t from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ParsedASTNode, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { UIDLStyleValue } from '@teleporthq/teleport-types'

export const generatePropSyntax = (
  style: Record<string, UIDLStyleValue>,
  tokensUsed?: string[],
  propsUsed?: string[]
) => {
  return UIDLUtils.transformDynamicStyles(style, (styleValue) => {
    switch (styleValue.content.referenceType) {
      case 'prop':
        propsUsed?.push(styleValue.content.id)
        return new ParsedASTNode(
          ASTBuilders.createArrowFunctionWithMemberExpression('props', styleValue.content.id)
        )
      case 'token':
        const token = StringUtils.capitalize(StringUtils.dashCaseToCamelCase(styleValue.content.id))
        tokensUsed?.push(token)
        return new ParsedASTNode(t.memberExpression(t.identifier('TOKENS'), t.identifier(token)))
      default:
        throw new Error(
          `Error running transformDynamicStyles in reactJSSComponentStyleChunksPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
        )
    }
  })
}

export const createStylesHookDecleration = (
  assignee: string,
  hookName: string,
  dynamicValueIdentifier?: string,
  types = t
) =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      t.identifier(assignee),
      t.callExpression(
        t.identifier(hookName),
        dynamicValueIdentifier ? [types.identifier(dynamicValueIdentifier)] : []
      )
    ),
  ])
