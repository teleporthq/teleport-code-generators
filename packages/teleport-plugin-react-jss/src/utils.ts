import * as types from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ParsedASTNode, ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLStyleSetDefinition, UIDLStyleValue } from '@teleporthq/teleport-types'

export const generateStylesFromStyleSetDefinitions = (params: {
  styleSetDefinitions: Record<string, UIDLStyleSetDefinition>
  styleSet: Record<string, unknown>
  mediaStyles: Record<string, Record<string, unknown>>
  tokensUsed?: string[]
  formatClassName?: boolean
}) => {
  const {
    styleSetDefinitions,
    styleSet,
    tokensUsed,
    formatClassName = false,
    mediaStyles = {},
  } = params
  Object.keys(styleSetDefinitions).forEach((styleId) => {
    const style = styleSetDefinitions[styleId]
    const className = formatClassName ? StringUtils.dashCaseToCamelCase(styleId) : styleId
    const { conditions = [], content } = style
    styleSet[className] = generateStylesFromStyleObj(content, tokensUsed)

    if (conditions.length > 0) {
      conditions.forEach((styleRef) => {
        if (Object.keys(styleRef.content).length === 0) {
          return
        }
        if (styleRef.type === 'screen-size') {
          mediaStyles[styleRef.meta.maxWidth] = {
            ...mediaStyles[styleRef.meta.maxWidth],
            [className]: generateStylesFromStyleObj(styleRef.content, tokensUsed),
          }
        }

        if (styleRef.type === 'element-state') {
          styleSet[className] = {
            ...((styleSet[className] as Record<string, unknown>) || {}),
            ...{
              [`&:${styleRef.meta.state}`]: generateStylesFromStyleObj(
                styleRef.content,
                tokensUsed
              ),
            },
          }
        }
      })
    }
  })
}

export const generateStylesFromStyleObj = (
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
        return new ParsedASTNode(
          types.memberExpression(types.identifier('TOKENS'), types.identifier(token))
        )
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
  dynamicValueIdentifier?: string
) =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(assignee),
      types.callExpression(
        types.identifier(hookName),
        dynamicValueIdentifier ? [types.identifier(dynamicValueIdentifier)] : []
      )
    ),
  ])

export const convertMediaAndStylesToObject = (
  styleSet: Record<string, unknown>,
  mediaStyles: Record<string, Record<string, unknown>>
): types.ObjectExpression => {
  const styles = ASTUtils.objectToObjectExpression(styleSet)

  Object.keys(mediaStyles).forEach((mediaKey: string) => {
    styles.properties.push(
      types.objectProperty(
        types.identifier(`'@media(max-width: ${mediaKey}px)'`),
        ASTUtils.objectToObjectExpression(mediaStyles[mediaKey])
      )
    )
  }, [])

  return styles
}
