import * as types from '@babel/types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ParsedASTNode, ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLStyleSetDefinition, UIDLStyleValue } from '@teleporthq/teleport-types'

export const generateProjectStyleSheet = (params: {
  styleSetDefinitions: Record<string, UIDLStyleSetDefinition>
  jssStyleMap: Array<Record<string, unknown>>
  mediaStyles: Record<string, Array<{ [x: string]: Record<string, string | number> }>>
  tokensUsed?: string[]
}) => {
  const { styleSetDefinitions = {}, jssStyleMap, tokensUsed, mediaStyles = {} } = params
  Object.keys(styleSetDefinitions).forEach((styleId) => {
    const style = styleSetDefinitions[styleId]
    const className = StringUtils.dashCaseToCamelCase(styleId)
    const { conditions = [], content } = style
    jssStyleMap.push({ [className]: generateStylesFromStyleObj(content, tokensUsed) })

    if (conditions.length > 0) {
      conditions.forEach(({ content: styleContent, meta, type }) => {
        if (Object.keys(styleContent).length === 0) {
          return
        }

        if (type === 'screen-size') {
          if (!mediaStyles[String(meta.maxWidth)]) {
            mediaStyles[String(meta.maxWidth)] = []
          }

          if (style.type === 'reusable-component-style-map') {
            mediaStyles[String(meta.maxWidth)].unshift({
              [className]: generateStylesFromStyleObj(styleContent, tokensUsed),
            })
          } else {
            mediaStyles[String(meta.maxWidth)].push({
              [className]: generateStylesFromStyleObj(styleContent, tokensUsed),
            })
          }
        }

        if (type === 'element-state') {
          jssStyleMap.find((item) => {
            if (style.hasOwnProperty(className)) {
              Object.assign(item[className], {
                [`&:${meta.state}`]: generateStylesFromStyleObj(styleContent, tokensUsed),
              })
            }
          })
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
  jssStyleMap: Array<Record<string, unknown>>,
  mediaStyles: Record<string, Array<{ [x: string]: Record<string, string | number> }>>
): types.ObjectExpression => {
  const styles = ASTUtils.objectToObjectExpression(convertArraytoObject(jssStyleMap))

  Object.keys(mediaStyles)
    .map((id) => Number(id))
    .sort((a, b) => b - a)
    .forEach((mediaOffset) => {
      styles.properties.push(
        types.objectProperty(
          types.identifier(`'@media(max-width: ${mediaOffset}px)'`),
          ASTUtils.objectToObjectExpression(
            convertArraytoObject(mediaStyles[String(mediaOffset)] || [])
          )
        )
      )
    }, [])

  return styles
}

const convertArraytoObject = (list: Array<Record<string, unknown>>): Record<string, unknown> =>
  list.reduce((acc, item) => {
    Object.assign(acc, item)
    return acc
  }, {})
